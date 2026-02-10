import type {
  AgentDefinition,
  AgentContext,
  Subtask,
  SubtaskResult,
  LLMAdapter,
  Plan,
  PermissionsConfig,
  ErrorDetail,
} from '../types/index.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { ScopedToolRegistry } from '../tools/scoped-tool-registry.js';
import type { EventBus } from '../observability/event-bus.js';
import type { TokenBudgetTracker } from '../llm/token-budget.js';
import { SubtaskTimeoutError } from '../errors/sdk-errors.js';

export interface AgentRunnerConfig {
  toolRegistry: ToolRegistry;
  defaultLLM: LLMAdapter;
  eventBus: EventBus;
  budgetTracker: TokenBudgetTracker;
  permissions: PermissionsConfig;
  subtaskTimeout?: number;
  createSubPlan?: (objective: string) => Promise<Plan>;
}

export class AgentRunner {
  constructor(private readonly config: AgentRunnerConfig) {}

  async run(
    agent: AgentDefinition,
    subtask: Subtask,
    signal: AbortSignal,
  ): Promise<SubtaskResult<unknown>> {
    const startTime = Date.now();
    const { eventBus, budgetTracker, config } = this;

    eventBus.emit('agent:started', agent.name, subtask.id);

    // Set up timeout
    const timeoutMs = config.subtaskTimeout;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const abortController = new AbortController();

    // Link parent signal
    const onParentAbort = () => abortController.abort();
    signal.addEventListener('abort', onParentAbort, { once: true });

    if (timeoutMs) {
      timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    }

    try {
      // Initialize agent if needed
      await agent.onInit?.();

      const llm = agent.llm ?? config.defaultLLM;
      const allowedTools = agent.tools ?? config.toolRegistry.names();

      const toolContext = {
        abortSignal: abortController.signal,
        logger: createLogger(agent.name),
      };

      const scopedTools = new ScopedToolRegistry(
        config.toolRegistry,
        allowedTools,
        agent.name,
        config.permissions,
        toolContext,
      );

      const context: AgentContext = {
        tools: scopedTools,
        llm: createBudgetTrackedLLM(llm, budgetTracker),
        abortSignal: abortController.signal,
        logger: createLogger(agent.name),
        emitEvent: (type: string, data: unknown) => {
          eventBus.emit('agent:progress', agent.name, { type, data });
        },
        createSubPlan: config.createSubPlan,
      };

      // Execute the agent
      const result = await agent.execute(subtask, context);

      if (abortController.signal.aborted) {
        throw new SubtaskTimeoutError(subtask.id, timeoutMs ?? 0);
      }

      // Add metadata
      const durationMs = Date.now() - startTime;
      if (!result.metadata) {
        result.metadata = { durationMs };
      } else {
        result.metadata.durationMs = durationMs;
      }

      eventBus.emit('agent:completed', agent.name, subtask.id);

      return result;
    } catch (error) {
      if (abortController.signal.aborted && timeoutMs) {
        throw new SubtaskTimeoutError(subtask.id, timeoutMs);
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      signal.removeEventListener('abort', onParentAbort);
      await agent.onDestroy?.();
    }
  }

  private get eventBus() {
    return this.config.eventBus;
  }

  private get budgetTracker() {
    return this.config.budgetTracker;
  }
}

function createLogger(agentName: string) {
  return {
    debug: (msg: string, ...args: unknown[]) =>
      console.debug(`[${agentName}] ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) =>
      console.info(`[${agentName}] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) =>
      console.warn(`[${agentName}] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) =>
      console.error(`[${agentName}] ${msg}`, ...args),
  };
}

function createBudgetTrackedLLM(
  llm: LLMAdapter,
  budget: TokenBudgetTracker,
): LLMAdapter {
  return {
    async complete(messages, options) {
      const result = await llm.complete(messages, options);
      budget.consume(result.tokensUsed.input + result.tokensUsed.output);
      return result;
    },
    stream(messages, options) {
      return llm.stream(messages, options);
    },
    async completeStructured(messages, schema, options) {
      return llm.completeStructured(messages, schema, options);
    },
    async countTokens(messages) {
      return llm.countTokens(messages);
    },
  };
}

export function errorToErrorDetail(error: unknown): ErrorDetail {
  if (error instanceof Error) {
    return {
      code: (error as { code?: string }).code ?? 'AGENT_FAILURE',
      message: error.message,
      retryable: (error as { retryable?: boolean }).retryable ?? false,
      source: 'agent',
      original: error,
    };
  }
  return {
    code: 'AGENT_FAILURE',
    message: String(error),
    retryable: false,
    source: 'agent',
    original: error,
  };
}
