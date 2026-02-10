import { describe, it, expect, vi } from 'vitest';
import { ErrorHandler } from '../../src/errors/error-handler.js';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import { MockLLMAdapter } from '../helpers/mock-llm.js';
import type { ErrorDetail, ErrorStrategy, Plan, Subtask } from '../../src/types/index.js';

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
    status: 'RUNNING',
  };
}

function makeError(overrides?: Partial<ErrorDetail>): ErrorDetail {
  return {
    code: 'TEST_ERROR',
    message: 'Something went wrong',
    retryable: false,
    source: 'agent',
    ...overrides,
  };
}

describe('ErrorHandler', () => {
  it('hook override takes precedence over rule-based handling', async () => {
    const hookStrategy: ErrorStrategy = { strategy: 'skip', reason: 'hook decided' };
    const hookRunner = new HookRunner({
      onError: async () => hookStrategy,
    });
    const llm = new MockLLMAdapter();
    const handler = new ErrorHandler({ hookRunner, llm });

    const result = await handler.handle(makeError({ retryable: true }), makePlan(), makeSubtask(), 0);
    expect(result.strategy).toBe('skip');
    expect(result.reason).toBe('hook decided');
    // LLM should NOT have been called
    expect(llm.calls).toHaveLength(0);
  });

  it('returns retry strategy for retryable errors within max retries', async () => {
    const hookRunner = new HookRunner({});
    const llm = new MockLLMAdapter();
    const handler = new ErrorHandler({ hookRunner, llm, maxRetries: 3, baseDelayMs: 100 });

    const retryFn = vi.fn();
    const result = await handler.handle(
      makeError({ retryable: true }),
      makePlan(),
      makeSubtask(),
      0,
      retryFn,
    );

    expect(result.strategy).toBe('retry');
    expect(result.delay).toBe(100); // baseDelayMs * 2^0
  });

  it('retry delay increases exponentially', async () => {
    const hookRunner = new HookRunner({});
    const llm = new MockLLMAdapter();
    const handler = new ErrorHandler({ hookRunner, llm, maxRetries: 3, baseDelayMs: 100 });

    const retryFn = vi.fn();
    const r1 = await handler.handle(makeError({ retryable: true }), makePlan(), makeSubtask(), 1, retryFn);
    expect(r1.delay).toBe(200); // 100 * 2^1

    const r2 = await handler.handle(makeError({ retryable: true }), makePlan(), makeSubtask(), 2, retryFn);
    expect(r2.delay).toBe(400); // 100 * 2^2
  });

  it('escalates to LLM after retry exhaustion', async () => {
    const hookRunner = new HookRunner({});
    const llm = new MockLLMAdapter();
    llm.completeHandler = () => ({
      content: JSON.stringify({ strategy: 'skip', reason: 'not critical' }),
      tokensUsed: { input: 10, output: 10 },
      finishReason: 'stop',
    });

    const handler = new ErrorHandler({ hookRunner, llm, maxRetries: 3 });

    // retryCount >= maxRetries, so escalates to LLM
    const result = await handler.handle(
      makeError({ retryable: true }),
      makePlan(),
      makeSubtask(),
      3,
      vi.fn(),
    );

    expect(result.strategy).toBe('skip');
    expect(result.reason).toBe('not critical');
    expect(llm.calls).toHaveLength(1);
  });

  it('escalates non-retryable errors to LLM', async () => {
    const hookRunner = new HookRunner({});
    const llm = new MockLLMAdapter();
    llm.completeHandler = () => ({
      content: JSON.stringify({ strategy: 'reassign', reason: 'try different agent' }),
      tokensUsed: { input: 10, output: 10 },
      finishReason: 'stop',
    });

    const handler = new ErrorHandler({ hookRunner, llm });
    const result = await handler.handle(makeError({ retryable: false }), makePlan(), makeSubtask(), 0);

    expect(result.strategy).toBe('reassign');
    expect(llm.calls).toHaveLength(1);
  });

  it('defaults to fail when LLM returns invalid JSON', async () => {
    const hookRunner = new HookRunner({});
    const llm = new MockLLMAdapter();
    llm.completeHandler = () => ({
      content: 'not valid json',
      tokensUsed: { input: 10, output: 10 },
      finishReason: 'stop',
    });

    const handler = new ErrorHandler({ hookRunner, llm });
    const result = await handler.handle(makeError(), makePlan(), makeSubtask(), 0);

    expect(result.strategy).toBe('fail');
    expect(result.reason).toContain('Unrecoverable');
  });

  it('defaults to fail when LLM itself throws', async () => {
    const hookRunner = new HookRunner({});
    const llm = new MockLLMAdapter();
    llm.completeHandler = () => { throw new Error('LLM down'); };

    const handler = new ErrorHandler({ hookRunner, llm });
    const result = await handler.handle(makeError(), makePlan(), makeSubtask(), 0);

    expect(result.strategy).toBe('fail');
    expect(result.reason).toContain('Unrecoverable');
  });

  it('defaults to fail when LLM returns unrecognized strategy', async () => {
    const hookRunner = new HookRunner({});
    const llm = new MockLLMAdapter();
    llm.completeHandler = () => ({
      content: JSON.stringify({ strategy: 'unknown', reason: 'wat' }),
      tokensUsed: { input: 10, output: 10 },
      finishReason: 'stop',
    });

    const handler = new ErrorHandler({ hookRunner, llm });
    const result = await handler.handle(makeError(), makePlan(), makeSubtask(), 0);
    expect(result.strategy).toBe('fail');
  });
});
