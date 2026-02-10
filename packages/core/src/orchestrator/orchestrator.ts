import type {
  OrchestratorConfig,
  Plan,
  SubtaskResult,
  AggregatedResult,
  StructuredEvent,
  AgentDefinition,
  ToolDefinition,
} from '../types/index.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { AgentRegistry } from '../agents/agent-registry.js';
import { EventBus } from '../observability/event-bus.js';
import { HookRunner } from '../hooks/hook-runner.js';
import { TokenBudgetTracker } from '../llm/token-budget.js';
import { InMemoryPlanStore } from '../state/in-memory-store.js';
import { ErrorHandler } from '../errors/error-handler.js';
import { Planner } from '../planner/planner.js';
import { DAGExecutor } from '../executor/dag-executor.js';
import { validateDAG } from '../executor/dag-validator.js';
import { aggregateResults } from '../agents/built-in/answer-generator.js';
import { httpFetchTool } from '../tools/built-in/http-fetch.js';
import { textExtractionTool } from '../tools/built-in/text-extraction.js';
import { researcherAgent } from '../agents/built-in/researcher.js';
import { analyzerAgent } from '../agents/built-in/analyzer.js';
import { answerGeneratorAgent } from '../agents/built-in/answer-generator.js';

export class Orchestrator {
  private readonly toolRegistry: ToolRegistry;
  private readonly agentRegistry: AgentRegistry;
  private readonly eventBus: EventBus;
  private readonly hookRunner: HookRunner;
  private readonly errorHandler: ErrorHandler;
  private readonly planner: Planner;
  private readonly store;
  private readonly config: OrchestratorConfig;
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(config: OrchestratorConfig) {
    this.config = config;

    // Event bus
    this.eventBus = new EventBus();

    // Hook runner
    this.hookRunner = new HookRunner(config.hooks ?? {});

    // Store
    this.store = config.store ?? new InMemoryPlanStore();

    // Tool registry
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.register(httpFetchTool);
    this.toolRegistry.register(textExtractionTool);
    if (config.tools) {
      for (const tool of config.tools) {
        this.toolRegistry.register(tool as ToolDefinition);
      }
    }

    // Agent registry
    this.agentRegistry = new AgentRegistry();
    this.agentRegistry.register(researcherAgent);
    this.agentRegistry.register(analyzerAgent);
    this.agentRegistry.register(answerGeneratorAgent);
    if (config.agents) {
      for (const agent of config.agents) {
        this.agentRegistry.register(agent);
      }
    }

    // Error handler
    this.errorHandler = new ErrorHandler({
      hookRunner: this.hookRunner,
      llm: config.planner.llm,
    });

    // Planner
    this.planner = new Planner(
      config.planner,
      this.agentRegistry,
      this.toolRegistry,
      this.hookRunner,
    );
  }

  async run(objective: string): Promise<AggregatedResult> {
    const startTime = Date.now();
    const maxBudget = this.config.limits?.maxTokensPerPlan ?? 100_000;
    const budgetTracker = new TokenBudgetTracker(maxBudget);

    const abortController = new AbortController();

    // Plan timeout
    const planTimeout = this.config.limits?.planTimeout;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (planTimeout) {
      timeoutId = setTimeout(() => abortController.abort(), planTimeout);
    }

    try {
      // Step 1: Plan
      const plan = await this.planner.plan(objective);
      this.eventBus.setPlanId(plan.id);
      this.eventBus.emit('plan:created', plan);
      this.abortControllers.set(plan.id, abortController);

      // Step 2: Validate DAG
      validateDAG(plan.subtasks);

      // Step 3: afterPlan hook
      const hookPlan = await this.hookRunner.run('afterPlan', plan);
      const effectivePlan = hookPlan || plan;

      // Step 4: Re-validate DAG after hook modifications
      validateDAG(effectivePlan.subtasks);

      // Step 5: Save task
      await this.store.save({
        id: effectivePlan.id,
        objective,
        plan: effectivePlan,
        status: 'EXECUTING',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Step 6: Create sub-plan factory for recursive planning
      const maxDepth = this.config.maxPlanDepth ?? 2;
      const createSubPlan = async (subObjective: string): Promise<Plan> => {
        if (effectivePlan.depth >= maxDepth) {
          throw new Error(`Max plan depth (${maxDepth}) exceeded`);
        }
        const childBudget = budgetTracker.fork();
        const subPlan = await this.planner.plan(
          subObjective,
          effectivePlan.id,
          effectivePlan.depth + 1,
        );
        validateDAG(subPlan.subtasks);
        return subPlan;
      };

      // Step 7: Execute
      const executor = new DAGExecutor({
        plan: effectivePlan,
        agentRegistry: this.agentRegistry,
        toolRegistry: this.toolRegistry,
        hookRunner: this.hookRunner,
        errorHandler: this.errorHandler,
        eventBus: this.eventBus,
        budgetTracker,
        defaultLLM: this.config.planner.llm,
        limits: this.config.limits ?? {},
        permissions: this.config.permissions ?? {},
        maxConcurrency: this.config.maxConcurrency ?? 5,
        createSubPlan,
        replan: async (p, r, trigger) =>
          this.planner.replan(p, r, trigger, objective),
        signal: abortController.signal,
      });

      const results = await executor.execute();

      // Step 8: Aggregate results
      const onPlanCompleteResult = await this.hookRunner.run(
        'onPlanComplete',
        effectivePlan,
        results,
      );

      let aggregatedResult: AggregatedResult;

      if (onPlanCompleteResult) {
        aggregatedResult = onPlanCompleteResult;
      } else {
        // Use answer generator or simple aggregation
        const aggregatedOutput = aggregateResults(results);

        aggregatedResult = {
          plan: effectivePlan,
          results,
          aggregatedOutput,
          totalDurationMs: Date.now() - startTime,
          totalTokensUsed: budgetTracker.used(),
        };
      }

      // Step 9: Emit completion
      const hasFailed = effectivePlan.subtasks.some((s) => s.status === 'FAILED');
      if (hasFailed) {
        const failedSubtasks = effectivePlan.subtasks.filter(
          (s) => s.status === 'FAILED',
        );
        this.eventBus.emit('plan:failed', effectivePlan, {
          code: 'PLAN_PARTIAL_FAILURE',
          message: `${failedSubtasks.length} subtask(s) failed`,
          retryable: false,
          source: 'system',
        });
      } else {
        this.eventBus.emit('plan:completed', effectivePlan, aggregatedResult);
      }

      // Update store
      await this.store.update(effectivePlan.id, {
        status: hasFailed ? 'FAILED' : 'COMPLETED',
        plan: effectivePlan,
      });

      return aggregatedResult;
    } catch (error) {
      // Emit plan:failed
      const errorDetail = {
        code: 'PLAN_ERROR',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        source: 'system' as const,
        original: error,
      };

      this.eventBus.emit('plan:failed', { id: '', interpretation: '', subtasks: [], depth: 0 }, errorDetail);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  stream(objective: string): AsyncIterable<StructuredEvent> {
    const iterable = this.eventBus.toAsyncIterable();

    // Start run in background
    this.run(objective).catch(() => {
      // Error is emitted as event, consumed by iterable
    });

    return iterable;
  }

  cancel(planId: string): void {
    const controller = this.abortControllers.get(planId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(planId);
    }
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }
}
