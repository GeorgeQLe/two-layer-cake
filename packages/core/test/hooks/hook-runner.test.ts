import { describe, it, expect, vi } from 'vitest';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import type { HookMap } from '../../src/types/hooks.js';
import type { Plan, Subtask } from '../../src/types/plan.js';

function makePlan(): Plan {
  return {
    id: 'plan-1',
    interpretation: 'test plan',
    subtasks: [],
    depth: 0,
  };
}

function makeSubtask(): Subtask {
  return {
    id: 'sub-1',
    description: 'do something',
    agentType: 'worker',
    dependsOn: [],
    priority: 'medium',
    status: 'PENDING',
  };
}

describe('HookRunner', () => {
  it('runs an async hook and returns its result', async () => {
    const hooks: HookMap = {
      afterPlan: async (plan) => ({ ...plan, reasoning: 'modified' }),
    };
    const runner = new HookRunner(hooks);

    const plan = makePlan();
    const result = await runner.run('afterPlan', plan);

    expect(result).not.toBeNull();
    expect((result as Plan).reasoning).toBe('modified');
  });

  it('runs a sync hook and returns its result', async () => {
    const hooks: HookMap = {
      afterPlan: (plan) => ({ ...plan, reasoning: 'sync-modified' }),
    };
    const runner = new HookRunner(hooks);

    const result = await runner.run('afterPlan', makePlan());
    expect((result as Plan).reasoning).toBe('sync-modified');
  });

  it('returns null when no hook is defined', async () => {
    const runner = new HookRunner({});
    const result = await runner.run('afterPlan', makePlan());
    expect(result).toBeNull();
  });

  it('returns null when hook returns undefined', async () => {
    const hooks: HookMap = {
      afterPlan: async () => {
        // intentionally returns undefined
      },
    };
    const runner = new HookRunner(hooks);

    const result = await runner.run('afterPlan', makePlan());
    expect(result).toBeNull();
  });

  it('returns null when hook returns null', async () => {
    const hooks: HookMap = {
      afterPlan: async () => null,
    };
    const runner = new HookRunner(hooks);

    const result = await runner.run('afterPlan', makePlan());
    expect(result).toBeNull();
  });

  it('passes correct arguments to multi-arg hooks', async () => {
    const hookFn = vi.fn().mockResolvedValue(null);
    const hooks: HookMap = {
      beforeAgentExecute: hookFn,
    };
    const runner = new HookRunner(hooks);

    const subtask = makeSubtask();
    const plan = makePlan();
    await runner.run('beforeAgentExecute', subtask, plan);

    expect(hookFn).toHaveBeenCalledWith(subtask, plan);
  });

  describe('hasHook', () => {
    it('returns true when hook is defined', () => {
      const hooks: HookMap = {
        afterPlan: async () => null,
      };
      const runner = new HookRunner(hooks);
      expect(runner.hasHook('afterPlan')).toBe(true);
    });

    it('returns false when hook is not defined', () => {
      const runner = new HookRunner({});
      expect(runner.hasHook('afterPlan')).toBe(false);
    });

    it('returns false when hook is undefined value', () => {
      const hooks: HookMap = {
        afterPlan: undefined,
      };
      const runner = new HookRunner(hooks);
      expect(runner.hasHook('afterPlan')).toBe(false);
    });
  });
});
