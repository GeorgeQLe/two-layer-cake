import type {
  OrchestratorConfig,
  AgentDefinition,
  StructuredEvent,
  AggregatedResult,
} from '../types/index.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { MockLLMAdapter } from './mock-llm-adapter.js';

export interface AgentCallRecord {
  agent: string;
  subtaskId: string;
  timestamp: Date;
}

export interface ToolCallRecord {
  tool: string;
  params: unknown;
  timestamp: Date;
}

export class TestOrchestrator {
  readonly agentCalls: AgentCallRecord[] = [];
  readonly toolCalls: ToolCallRecord[] = [];
  readonly events: StructuredEvent[] = [];
  readonly mockLLM: MockLLMAdapter;

  private readonly orchestrator: Orchestrator;

  constructor(
    config: Partial<OrchestratorConfig> & {
      agents?: AgentDefinition[];
      llm?: MockLLMAdapter;
    } = {},
  ) {
    this.mockLLM = config.llm ?? new MockLLMAdapter();

    this.orchestrator = new Orchestrator({
      planner: {
        llm: this.mockLLM,
        mode: 'single-shot',
        ...config.planner,
      },
      agents: config.agents,
      tools: config.tools,
      hooks: config.hooks,
      limits: {
        maxTokensPerPlan: 100_000,
        maxTokensPerAgent: 20_000,
        planTimeout: 30_000,
        subtaskTimeout: 10_000,
        ...config.limits,
      },
      permissions: {
        autoApprove: ['read-only', 'network', 'write', 'execute'],
        ...config.permissions,
      },
      maxConcurrency: config.maxConcurrency ?? 5,
      maxPlanDepth: config.maxPlanDepth ?? 2,
    });

    // Track events
    this.orchestrator.getEventBus().onStructured((event) => {
      this.events.push(event);
    });

    // Track agent calls
    this.orchestrator.getEventBus().on('agent:started', (agentId, subtaskId) => {
      this.agentCalls.push({
        agent: agentId,
        subtaskId,
        timestamp: new Date(),
      });
    });
  }

  async run(objective: string): Promise<AggregatedResult> {
    return this.orchestrator.run(objective);
  }

  stream(objective: string): AsyncIterable<StructuredEvent> {
    return this.orchestrator.stream(objective);
  }

  cancel(planId: string): void {
    this.orchestrator.cancel(planId);
  }

  reset(): void {
    this.agentCalls.length = 0;
    this.toolCalls.length = 0;
    this.events.length = 0;
    this.mockLLM.reset();
  }
}
