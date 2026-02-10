import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Planner, resetPlanIdCounter } from '../../src/planner/planner.js';
import { AgentRegistry } from '../../src/agents/agent-registry.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import { MockLLMAdapter } from '../helpers/mock-llm.js';
import type { Plan, Subtask, SubtaskResult } from '../../src/types/index.js';

function makePlanOutput() {
  return {
    interpretation: 'Understood the task',
    subtasks: [
      {
        id: 'step-1',
        description: 'Research the topic',
        agentType: 'researcher',
        dependsOn: [],
        priority: 'high' as const,
      },
    ],
    reasoning: 'Simple research task',
  };
}

function createPlanner(opts?: { mode?: 'single-shot' | 'stepwise'; hooks?: Record<string, any> }) {
  const llm = new MockLLMAdapter();
  llm.structuredHandler = () => makePlanOutput();

  const agentRegistry = new AgentRegistry();
  const toolRegistry = new ToolRegistry();
  const hookRunner = new HookRunner(opts?.hooks ?? {});

  const planner = new Planner(
    { llm, mode: opts?.mode ?? 'single-shot' },
    agentRegistry,
    toolRegistry,
    hookRunner,
  );

  return { planner, llm };
}

beforeEach(() => {
  resetPlanIdCounter();
});

describe('Planner', () => {
  it('plan() calls LLM completeStructured and returns a Plan', async () => {
    const { planner, llm } = createPlanner();

    const plan = await planner.plan('Research AI');
    expect(plan.interpretation).toBe('Understood the task');
    expect(plan.subtasks).toHaveLength(1);
    expect(plan.subtasks[0].id).toBe('step-1');
    expect(plan.subtasks[0].status).toBe('PENDING');
    expect(plan.depth).toBe(0);
    expect(plan.reasoning).toBe('Simple research task');

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
  });

  it('plan() sets status BLOCKED when subtask has dependencies', async () => {
    const { planner, llm } = createPlanner();
    llm.structuredHandler = () => ({
      interpretation: 'multi-step',
      subtasks: [
        { id: 's1', description: 'first', agentType: 'a', dependsOn: [], priority: 'high' },
        { id: 's2', description: 'second', agentType: 'b', dependsOn: ['s1'], priority: 'medium' },
      ],
    });

    const plan = await planner.plan('multi-step task');
    expect(plan.subtasks[0].status).toBe('PENDING');
    expect(plan.subtasks[1].status).toBe('BLOCKED');
  });

  it('stepwise mode makes complete + completeStructured calls', async () => {
    const { planner, llm } = createPlanner({ mode: 'stepwise' });

    llm.completeHandler = () => ({
      content: 'My interpretation',
      tokensUsed: { input: 10, output: 10 },
      finishReason: 'stop',
    });

    const plan = await planner.plan('stepwise objective');

    // Step 1: complete (interpret), Step 2: completeStructured (decompose)
    const completeCalls = llm.calls.filter((c) => c.method === 'complete');
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(completeCalls).toHaveLength(1);
    expect(structuredCalls).toHaveLength(1);

    // stepwise overrides interpretation with the complete() result
    expect(plan.interpretation).toBe('My interpretation');
  });

  it('beforePlan hook can modify the objective', async () => {
    const { planner, llm } = createPlanner({
      hooks: {
        beforePlan: async (ctx: { objective: string }) => ({
          ...ctx,
          objective: 'Modified: ' + ctx.objective,
        }),
      },
    });

    await planner.plan('original objective');

    // The modified objective should appear in the user message
    const call = llm.calls[0];
    const userMsg = call.messages.find((m) => m.role === 'user');
    expect(userMsg!.content).toBe('Modified: original objective');
  });

  it('replan() calls LLM and returns updated Plan', async () => {
    const { planner, llm } = createPlanner();

    const existingPlan: Plan = {
      id: 'plan-existing',
      interpretation: 'old interpretation',
      subtasks: [
        {
          id: 's1',
          description: 'done task',
          agentType: 'researcher',
          dependsOn: [],
          priority: 'medium',
          status: 'COMPLETED',
        },
      ],
      depth: 0,
    };

    const results = new Map<string, SubtaskResult<unknown>>();
    results.set('s1', { status: 'success', data: 'result data', metadata: { durationMs: 100 } });

    const newPlan = await planner.replan(existingPlan, results, 'error occurred', 'Do research');

    expect(newPlan.id).toBe('plan-existing');
    expect(newPlan.depth).toBe(0);

    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
  });

  it('plan() passes parentPlanId and depth', async () => {
    const { planner } = createPlanner();
    const plan = await planner.plan('sub-objective', 'parent-123', 2);
    expect(plan.parentPlanId).toBe('parent-123');
    expect(plan.depth).toBe(2);
  });
});
