import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DAGExecutor, type DAGExecutorConfig } from '../../src/executor/dag-executor.js';
import { AgentRegistry } from '../../src/agents/agent-registry.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import { ErrorHandler } from '../../src/errors/error-handler.js';
import { EventBus } from '../../src/observability/event-bus.js';
import { TokenBudgetTracker } from '../../src/llm/token-budget.js';
import { MockLLMAdapter } from '../helpers/mock-llm.js';
import { defineAgent } from '../../src/agents/define-agent.js';
import type { Plan, Subtask, SubtaskResult } from '../../src/types/index.js';

function makeAgent(name: string, handler?: (subtask: Subtask) => Promise<SubtaskResult<unknown>>) {
  return defineAgent({
    name,
    description: `${name} agent`,
    capabilities: ['work'],
    execute: handler ?? (async (subtask) => ({
      status: 'success' as const,
      data: `${name}-result-${subtask.id}`,
      metadata: { durationMs: 1 },
    })),
  });
}

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
      subtasks: [
        makeSubtask('s1', 'agent-a'),
        makeSubtask('s2', 'agent-a', ['s1']),
      ],
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
      execute: async () => { throw new Error('boom'); },
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
    const results = await executor.execute();

    const subtask = plan.subtasks[0];
    expect(subtask.status).toBe('SKIPPED');
  });

  it('handles agent error with fail strategy', async () => {
    const failAgent = defineAgent({
      name: 'fail-agent',
      description: 'F',
      capabilities: ['work'],
      execute: async () => { throw new Error('fatal'); },
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
    const results = await executor.execute();

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
      execute: async () => { throw new Error('dep error'); },
    });

    const okAgent = defineAgent({
      name: 'ok-dep',
      description: 'O',
      capabilities: ['work'],
      execute: async (s) => ({ status: 'success' as const, data: 'ok', metadata: { durationMs: 1 } }),
    });

    const plan: Plan = {
      id: 'plan-6',
      interpretation: 'dep fail plan',
      subtasks: [
        makeSubtask('s1', 'fail-dep'),
        makeSubtask('s2', 'ok-dep', ['s1']),
      ],
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
});
