import { describe, it, expect } from 'vitest';
import { DAGExecutor, type DAGExecutorConfig } from '../../src/executor/dag-executor.js';
import { AgentRegistry } from '../../src/agents/agent-registry.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import { ErrorHandler } from '../../src/errors/error-handler.js';
import { EventBus } from '../../src/observability/event-bus.js';
import { TokenBudgetTracker } from '../../src/llm/token-budget.js';
import { MockLLMAdapter } from '../helpers/mock-llm.js';
import { defineAgent } from '../../src/agents/define-agent.js';
import type { Plan, Subtask } from '../../src/types/index.js';

function makeSubtask(id: string, agentType: string, dependsOn: string[] = []): Subtask {
  return {
    id,
    description: `Task ${id}`,
    agentType,
    dependsOn,
    priority: 'medium',
    status: dependsOn.length > 0 ? 'BLOCKED' : 'PENDING',
  };
}

function createConfig(plan: Plan, overrides?: Partial<DAGExecutorConfig>): DAGExecutorConfig {
  const llm = new MockLLMAdapter();
  const agentRegistry = new AgentRegistry();
  const toolRegistry = new ToolRegistry();
  const hookRunner = new HookRunner({});
  const eventBus = new EventBus();
  const budgetTracker = new TokenBudgetTracker(100_000);
  const errorHandler = new ErrorHandler({ hookRunner, llm });

  return {
    plan,
    agentRegistry,
    toolRegistry,
    hookRunner,
    errorHandler,
    eventBus,
    budgetTracker,
    defaultLLM: llm,
    limits: {},
    permissions: { autoApprove: ['read-only', 'write', 'execute', 'network'] },
    maxConcurrency: 3,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('DAGExecutor', () => {
  it('executes a linear plan in order', async () => {
    const executionOrder: string[] = [];

    const agentA = defineAgent({
      name: 'agent-a',
      description: 'A',
      capabilities: ['work'],
      execute: async (subtask) => {
        executionOrder.push(subtask.id);
        return { status: 'success', data: `result-${subtask.id}`, metadata: { durationMs: 1 } };
      },
    });

    const plan: Plan = {
      id: 'plan-1',
      interpretation: 'linear plan',
      subtasks: [makeSubtask('s1', 'agent-a'), makeSubtask('s2', 'agent-a', ['s1'])],
      depth: 0,
    };

    const config = createConfig(plan);
    config.agentRegistry.register(agentA);

    const executor = new DAGExecutor(config);
    const results = await executor.execute();

    expect(executionOrder).toEqual(['s1', 's2']);
    expect(results.size).toBe(2);
    expect(results.get('s1')!.status).toBe('success');
    expect(results.get('s2')!.status).toBe('success');
  });

  it('executes parallel fan-out subtasks concurrently', async () => {
    const running = new Set<string>();
    let maxConcurrent = 0;

    const agent = defineAgent({
      name: 'parallel-agent',
      description: 'P',
      capabilities: ['work'],
      execute: async (subtask) => {
        running.add(subtask.id);
        maxConcurrent = Math.max(maxConcurrent, running.size);
        await new Promise((r) => setTimeout(r, 20));
        running.delete(subtask.id);
        return { status: 'success', data: subtask.id, metadata: { durationMs: 1 } };
      },
    });

    const plan: Plan = {
      id: 'plan-2',
      interpretation: 'parallel plan',
      subtasks: [
        makeSubtask('a', 'parallel-agent'),
        makeSubtask('b', 'parallel-agent'),
        makeSubtask('c', 'parallel-agent'),
      ],
      depth: 0,
    };

    const config = createConfig(plan);
    config.agentRegistry.register(agent);

    const executor = new DAGExecutor(config);
    const results = await executor.execute();

    expect(results.size).toBe(3);
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  it('handles agent error with skip strategy', async () => {
    const failAgent = defineAgent({
      name: 'fail-agent',
      description: 'F',
      capabilities: ['work'],
      execute: async () => {
        throw new Error('boom');
      },
    });

    const plan: Plan = {
      id: 'plan-3',
      interpretation: 'error plan',
      subtasks: [makeSubtask('s1', 'fail-agent')],
      depth: 0,
    };

    // Error handler that returns skip
    const hookRunner = new HookRunner({
      onError: async () => ({ strategy: 'skip' as const, reason: 'skip it' }),
    });
    const llm = new MockLLMAdapter();
    const errorHandler = new ErrorHandler({ hookRunner, llm });

    const config = createConfig(plan, { hookRunner, errorHandler });
    config.agentRegistry.register(failAgent);

    const executor = new DAGExecutor(config);
    await executor.execute();

    const subtask = plan.subtasks[0];
    expect(subtask.status).toBe('SKIPPED');
  });

  it('handles agent error with fail strategy', async () => {
    const failAgent = defineAgent({
      name: 'fail-agent',
      description: 'F',
      capabilities: ['work'],
      execute: async () => {
        throw new Error('fatal');
      },
    });

    const plan: Plan = {
      id: 'plan-4',
      interpretation: 'fail plan',
      subtasks: [makeSubtask('s1', 'fail-agent')],
      depth: 0,
    };

    // Error handler returns fail
    const hookRunner = new HookRunner({
      onError: async () => ({ strategy: 'fail' as const, reason: 'abort' }),
    });
    const llm = new MockLLMAdapter();
    const errorHandler = new ErrorHandler({ hookRunner, llm });

    const config = createConfig(plan, { hookRunner, errorHandler });
    config.agentRegistry.register(failAgent);

    const executor = new DAGExecutor(config);
    const results = await executor.execute();

    expect(plan.subtasks[0].status).toBe('FAILED');
    expect(results.get('s1')!.status).toBe('failed');
  });

  it('abort signal cancels pending subtasks', async () => {
    const controller = new AbortController();

    const slowAgent = defineAgent({
      name: 'slow-agent',
      description: 'S',
      capabilities: ['work'],
      execute: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { status: 'success' as const, data: null, metadata: { durationMs: 500 } };
      },
    });

    const plan: Plan = {
      id: 'plan-5',
      interpretation: 'abort plan',
      subtasks: [
        makeSubtask('s1', 'slow-agent'),
        // s2 depends on s1, so it stays BLOCKED while s1 runs its 500ms sleep
        makeSubtask('s2', 'slow-agent', ['s1']),
      ],
      depth: 0,
    };

    const config = createConfig(plan, { signal: controller.signal });
    config.agentRegistry.register(slowAgent);

    // Abort after a short delay — s1 is still running, s2 is still BLOCKED
    setTimeout(() => controller.abort(), 30);

    const executor = new DAGExecutor(config);
    await executor.execute();

    // s2 should have been cancelled (SKIPPED) since it was still BLOCKED when abort fired
    const skipped = plan.subtasks.filter((s) => s.status === 'SKIPPED');
    const failed = plan.subtasks.filter((s) => s.status === 'FAILED');
    expect(skipped.length + failed.length).toBeGreaterThan(0);
  });

  it('skips subtask when dependency failed', async () => {
    const failAgent = defineAgent({
      name: 'fail-dep',
      description: 'F',
      capabilities: ['work'],
      execute: async () => {
        throw new Error('dep error');
      },
    });

    const okAgent = defineAgent({
      name: 'ok-dep',
      description: 'O',
      capabilities: ['work'],
      execute: async () => ({
        status: 'success' as const,
        data: 'ok',
        metadata: { durationMs: 1 },
      }),
    });

    const plan: Plan = {
      id: 'plan-6',
      interpretation: 'dep fail plan',
      subtasks: [makeSubtask('s1', 'fail-dep'), makeSubtask('s2', 'ok-dep', ['s1'])],
      depth: 0,
    };

    const hookRunner = new HookRunner({
      onError: async () => ({ strategy: 'fail' as const, reason: 'fail it' }),
    });
    const llm = new MockLLMAdapter();
    const errorHandler = new ErrorHandler({ hookRunner, llm });

    const config = createConfig(plan, { hookRunner, errorHandler });
    config.agentRegistry.register(failAgent);
    config.agentRegistry.register(okAgent);

    const executor = new DAGExecutor(config);
    await executor.execute();

    expect(plan.subtasks[0].status).toBe('FAILED');
    expect(plan.subtasks[1].status).toBe('SKIPPED');
  });

  describe('DAG dependency ordering', () => {
    it('diamond dependency: D runs after both B and C', async () => {
      const executionOrder: string[] = [];

      const agent = defineAgent({
        name: 'diamond-agent',
        description: 'Diamond',
        capabilities: ['work'],
        execute: async (subtask) => {
          executionOrder.push(subtask.id);
          return {
            status: 'success' as const,
            data: `result-${subtask.id}`,
            metadata: { durationMs: 1 },
          };
        },
      });

      const plan: Plan = {
        id: 'plan-diamond',
        interpretation: 'diamond dag',
        subtasks: [
          makeSubtask('A', 'diamond-agent'),
          makeSubtask('B', 'diamond-agent', ['A']),
          makeSubtask('C', 'diamond-agent', ['A']),
          makeSubtask('D', 'diamond-agent', ['B', 'C']),
        ],
        depth: 0,
      };

      const config = createConfig(plan);
      config.agentRegistry.register(agent);

      const executor = new DAGExecutor(config);
      const results = await executor.execute();

      expect(results.size).toBe(4);
      // A must be first
      expect(executionOrder[0]).toBe('A');
      // D must be last (after both B and C)
      expect(executionOrder[3]).toBe('D');
      // B and C are in between (order doesn't matter)
      expect(executionOrder.slice(1, 3).sort()).toEqual(['B', 'C']);
    });

    it('fan-in: multiple deps must all complete before dependent starts', async () => {
      const completedBefore: Record<string, string[]> = {};

      const agent = defineAgent({
        name: 'fanin-agent',
        description: 'Fan-in',
        capabilities: ['work'],
        execute: async (subtask) => {
          completedBefore[subtask.id] = [...Object.keys(completedBefore)];
          await new Promise((r) => setTimeout(r, 10));
          return { status: 'success' as const, data: subtask.id, metadata: { durationMs: 1 } };
        },
      });

      const plan: Plan = {
        id: 'plan-fanin',
        interpretation: 'fan-in',
        subtasks: [
          makeSubtask('x1', 'fanin-agent'),
          makeSubtask('x2', 'fanin-agent'),
          makeSubtask('x3', 'fanin-agent', ['x1', 'x2']),
        ],
        depth: 0,
      };

      const config = createConfig(plan);
      config.agentRegistry.register(agent);

      const executor = new DAGExecutor(config);
      await executor.execute();

      // x3 should have seen both x1 and x2 completed before it started
      expect(completedBefore['x3']).toContain('x1');
      expect(completedBefore['x3']).toContain('x2');
    });
  });

  describe('budget limit enforcement', () => {
    it('budget exhaustion causes subtask failure', async () => {
      const llm = new MockLLMAdapter();
      llm.completeHandler = () => ({
        content: 'result',
        tokensUsed: { input: 500, output: 500 }, // 1000 tokens, exceeds budget of 100
        finishReason: 'stop',
      });

      const agent = defineAgent({
        name: 'expensive-agent',
        description: 'Expensive',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          await context.llm.complete([{ role: 'user', content: 'hi' }]);
          return { status: 'success' as const, data: 'ok', metadata: { durationMs: 1 } };
        },
      });

      const plan: Plan = {
        id: 'plan-budget',
        interpretation: 'budget plan',
        subtasks: [makeSubtask('b1', 'expensive-agent')],
        depth: 0,
      };

      const budgetTracker = new TokenBudgetTracker(100);
      const config = createConfig(plan, { budgetTracker, defaultLLM: llm });
      config.agentRegistry.register(agent);

      const executor = new DAGExecutor(config);
      const results = await executor.execute();

      expect(results.get('b1')!.status).toBe('failed');
      expect(plan.subtasks[0]!.status).toBe('FAILED');
    });
  });

  describe('contextFromPrevious', () => {
    it('populates contextFromPrevious from parent result when subtask has existing contextFromPrevious', async () => {
      let receivedContext = '';

      const parentAgent = defineAgent({
        name: 'parent-agent',
        description: 'Parent',
        capabilities: ['work'],
        execute: async () => ({
          status: 'success' as const,
          data: 'parent-data',
          metadata: { durationMs: 1 },
        }),
      });

      const childAgent = defineAgent({
        name: 'child-agent',
        description: 'Child',
        capabilities: ['work'],
        execute: async (subtask) => {
          receivedContext = subtask.contextFromPrevious ?? '';
          return { status: 'success' as const, data: 'child-data', metadata: { durationMs: 1 } };
        },
      });

      const childSubtask = makeSubtask('child', 'child-agent', ['parent']);
      childSubtask.contextFromPrevious = 'Initial context';

      const plan: Plan = {
        id: 'plan-context',
        interpretation: 'context plan',
        subtasks: [makeSubtask('parent', 'parent-agent'), childSubtask],
        depth: 0,
      };

      const config = createConfig(plan);
      config.agentRegistry.register(parentAgent);
      config.agentRegistry.register(childAgent);

      const executor = new DAGExecutor(config);
      await executor.execute();

      expect(receivedContext).toContain('Initial context');
      expect(receivedContext).toContain('[parent]: parent-data');
    });
  });
});
