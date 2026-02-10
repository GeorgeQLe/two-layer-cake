import type {
  Plan,
  Subtask,
  SubtaskResult,
  ErrorDetail,
  LimitsConfig,
  PermissionsConfig,
  LLMAdapter,
} from '../types/index.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { HookRunner } from '../hooks/hook-runner.js';
import type { ErrorHandler } from '../errors/error-handler.js';
import type { EventBus } from '../observability/event-bus.js';
import type { TokenBudgetTracker } from '../llm/token-budget.js';
import { ConcurrencyPool } from './concurrency-pool.js';
import { AgentRunner } from '../agents/agent-runner.js';
import { errorToErrorDetail } from '../agents/agent-runner.js';
import { validateDAG } from './dag-validator.js';

export interface DAGExecutorConfig {
  plan: Plan;
  agentRegistry: AgentRegistry;
  toolRegistry: ToolRegistry;
  hookRunner: HookRunner;
  errorHandler: ErrorHandler;
  eventBus: EventBus;
  budgetTracker: TokenBudgetTracker;
  defaultLLM: LLMAdapter;
  limits: LimitsConfig;
  permissions: PermissionsConfig;
  maxConcurrency: number;
  createSubPlan?: (objective: string) => Promise<Plan>;
  replan?: (plan: Plan, results: Map<string, SubtaskResult<unknown>>, trigger: string) => Promise<Plan>;
  signal: AbortSignal;
}

export class DAGExecutor {
  private readonly pool: ConcurrencyPool;
  private readonly results = new Map<string, SubtaskResult<unknown>>();
  private plan: Plan;
  private readonly agentRunner: AgentRunner;

  constructor(private readonly config: DAGExecutorConfig) {
    this.pool = new ConcurrencyPool(config.maxConcurrency);
    this.plan = config.plan;
    this.agentRunner = new AgentRunner({
      toolRegistry: config.toolRegistry,
      defaultLLM: config.defaultLLM,
      eventBus: config.eventBus,
      budgetTracker: config.budgetTracker,
      permissions: config.permissions,
      subtaskTimeout: config.limits.subtaskTimeout,
      createSubPlan: config.createSubPlan,
    });
  }

  async execute(): Promise<Map<string, SubtaskResult<unknown>>> {
    const { eventBus, signal } = this.config;

    eventBus.emit('plan:executing', this.plan);

    while (true) {
      if (signal.aborted) {
        this.cancelPending();
        break;
      }

      const ready = this.getReadySubtasks();
      const inProgress = this.plan.subtasks.filter((s) => s.status === 'RUNNING');

      if (ready.length === 0 && inProgress.length === 0) {
        break;
      }

      if (ready.length === 0) {
        // Wait for currently running tasks
        await this.waitForAny();
        continue;
      }

      const dispatches = ready.map((subtask) => this.dispatchSubtask(subtask));
      await Promise.race([
        Promise.allSettled(dispatches),
        this.waitForAbort(signal),
      ]);
    }

    return this.results;
  }

  private getReadySubtasks(): Subtask[] {
    return this.plan.subtasks.filter((s) => {
      if (s.status !== 'PENDING' && s.status !== 'BLOCKED') return false;

      const allDepsComplete = s.dependsOn.every((depId) => {
        const dep = this.plan.subtasks.find((d) => d.id === depId);
        return dep?.status === 'COMPLETED' || dep?.status === 'SKIPPED';
      });

      // Check if any dependency failed
      const anyDepFailed = s.dependsOn.some((depId) => {
        const dep = this.plan.subtasks.find((d) => d.id === depId);
        return dep?.status === 'FAILED';
      });

      if (anyDepFailed) {
        s.status = 'SKIPPED';
        this.config.eventBus.emit('subtask:skipped', s, 'Dependency failed');
        return false;
      }

      return allDepsComplete;
    });
  }

  private async dispatchSubtask(subtask: Subtask): Promise<void> {
    const { hookRunner, errorHandler, eventBus, signal } = this.config;

    subtask.status = 'RUNNING';
    eventBus.emit('subtask:started', subtask);

    try {
      await this.pool.run(async () => {
        // beforeAgentExecute hook
        let effectiveSubtask = subtask;
        if (hookRunner.hasHook('beforeAgentExecute')) {
          const hookSubtask = await hookRunner.run('beforeAgentExecute', subtask, this.plan);
          if (hookSubtask === null) {
            // Hook signaled to skip
            subtask.status = 'SKIPPED';
            eventBus.emit('subtask:skipped', subtask, 'Skipped by beforeAgentExecute hook');
            return;
          }
          if (hookSubtask) {
            effectiveSubtask = hookSubtask;
          }
        }

        // Resolve agent
        const agent = this.config.agentRegistry.resolve(effectiveSubtask.agentType);
        if (!agent) {
          throw new Error(`Unknown agent type: ${effectiveSubtask.agentType}`);
        }

        // Add context from previous results
        if (effectiveSubtask.contextFromPrevious) {
          const contextData: string[] = [];
          for (const depId of effectiveSubtask.dependsOn) {
            const depResult = this.results.get(depId);
            if (depResult) {
              contextData.push(
                `[${depId}]: ${typeof depResult.data === 'string' ? depResult.data : JSON.stringify(depResult.data)}`,
              );
            }
          }
          if (contextData.length > 0) {
            effectiveSubtask.contextFromPrevious =
              effectiveSubtask.contextFromPrevious + '\n\n' + contextData.join('\n\n');
          }
        }

        // Execute
        let result: SubtaskResult<unknown>;
        let retryCount = 0;
        const maxRetries = 3;

        while (true) {
          try {
            result = await this.agentRunner.run(agent, effectiveSubtask, signal);
            break;
          } catch (error) {
            const errorDetail = errorToErrorDetail(error);

            const strategy = await errorHandler.handle(
              errorDetail,
              this.plan,
              effectiveSubtask,
              retryCount,
            );

            if (strategy.strategy === 'retry' && retryCount < maxRetries) {
              retryCount++;
              if (strategy.delay) {
                await new Promise((r) => setTimeout(r, strategy.delay));
              }
              continue;
            }

            if (strategy.strategy === 'skip') {
              subtask.status = 'SKIPPED';
              eventBus.emit('subtask:skipped', subtask, strategy.reason ?? 'Error handler decided to skip');
              return;
            }

            if (strategy.strategy === 'fail') {
              subtask.status = 'FAILED';
              subtask.error = errorDetail;
              eventBus.emit('subtask:failed', subtask, errorDetail);
              this.results.set(subtask.id, {
                status: 'failed',
                data: null,
                errors: [errorDetail],
                metadata: { durationMs: 0 },
              });
              return;
            }

            // reassign or other: treat as failure
            subtask.status = 'FAILED';
            subtask.error = errorDetail;
            eventBus.emit('subtask:failed', subtask, errorDetail);
            this.results.set(subtask.id, {
              status: 'failed',
              data: null,
              errors: [errorDetail],
              metadata: { durationMs: 0 },
            });
            return;
          }
        }

        // afterAgentExecute hook
        const hookResult = await hookRunner.run('afterAgentExecute', effectiveSubtask, result);
        const finalResult = hookResult || result;

        subtask.status = 'COMPLETED';
        subtask.result = finalResult;
        this.results.set(subtask.id, finalResult);
        eventBus.emit('subtask:completed', subtask, finalResult);

        // Check if replan is needed
        if (finalResult.replanNeeded && this.config.replan) {
          try {
            const newPlan = await this.config.replan(
              this.plan,
              this.results,
              `Agent ${agent.name} flagged result for re-planning`,
            );
            validateDAG(newPlan.subtasks);
            // Merge: keep completed subtasks, add new ones
            this.mergePlan(newPlan);
          } catch {
            // Replan failed, continue with current plan
          }
        }
      }, signal);
    } catch (error) {
      if (subtask.status === 'RUNNING') {
        const errorDetail = errorToErrorDetail(error);
        subtask.status = 'FAILED';
        subtask.error = errorDetail;
        eventBus.emit('subtask:failed', subtask, errorDetail);
        this.results.set(subtask.id, {
          status: 'failed',
          data: null,
          errors: [errorDetail],
          metadata: { durationMs: 0 },
        });
      }
    }
  }

  private mergePlan(newPlan: Plan): void {
    // Keep completed/failed/skipped subtasks, replace the rest
    const completedIds = new Set(
      this.plan.subtasks
        .filter((s) => s.status === 'COMPLETED' || s.status === 'FAILED' || s.status === 'SKIPPED')
        .map((s) => s.id),
    );

    const kept = this.plan.subtasks.filter((s) => completedIds.has(s.id));
    const newSubtasks = newPlan.subtasks.filter((s) => !completedIds.has(s.id));

    this.plan = {
      ...this.plan,
      subtasks: [...kept, ...newSubtasks],
      interpretation: newPlan.interpretation,
      reasoning: newPlan.reasoning,
    };
  }

  private cancelPending(): void {
    for (const subtask of this.plan.subtasks) {
      if (subtask.status === 'PENDING' || subtask.status === 'BLOCKED') {
        subtask.status = 'SKIPPED';
        this.config.eventBus.emit(
          'subtask:skipped',
          subtask,
          'Plan cancelled',
        );
      }
    }
  }

  private runningPromises = new Map<string, Promise<void>>();

  private waitForAny(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }

  private waitForAbort(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}
