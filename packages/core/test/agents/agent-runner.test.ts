import { describe, it, expect } from 'vitest';
import { AgentRunner, errorToErrorDetail } from '../../src/agents/agent-runner.js';
import { EventBus } from '../../src/observability/event-bus.js';
import { TokenBudgetTracker } from '../../src/llm/token-budget.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { MockLLMAdapter } from '../helpers/mock-llm.js';
import { defineAgent } from '../../src/agents/define-agent.js';
import { SubtaskTimeoutError } from '../../src/errors/sdk-errors.js';
import type { Subtask, LLMAdapter } from '../../src/types/index.js';

function makeSubtask(overrides?: Partial<Subtask>): Subtask {
  return {
    id: 'sub-1',
    description: 'Test subtask',
    agentType: 'test-agent',
    dependsOn: [],
    priority: 'medium',
    status: 'PENDING',
    ...overrides,
  };
}

function makeRunner(overrides?: { llm?: LLMAdapter; budget?: number; subtaskTimeout?: number }) {
  const llm = overrides?.llm ?? new MockLLMAdapter();
  const eventBus = new EventBus();
  const budgetTracker = new TokenBudgetTracker(overrides?.budget ?? 100_000);
  const toolRegistry = new ToolRegistry();

  const runner = new AgentRunner({
    toolRegistry,
    defaultLLM: llm,
    eventBus,
    budgetTracker,
    permissions: { autoApprove: ['read-only', 'write', 'execute', 'network'] },
    subtaskTimeout: overrides?.subtaskTimeout,
  });

  return { runner, llm, eventBus, budgetTracker, toolRegistry };
}

describe('AgentRunner', () => {
  describe('run()', () => {
    it('runs an agent and returns SubtaskResult with durationMs', async () => {
      const { runner } = makeRunner();
      const agent = defineAgent({
        name: 'test-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async () => ({
          status: 'success' as const,
          data: 'done',
          metadata: { durationMs: 0 },
        }),
      });

      const result = await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(result.status).toBe('success');
      expect(result.data).toBe('done');
      expect(result.metadata!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('calls onInit before execution and onDestroy after', async () => {
      const { runner } = makeRunner();
      const callOrder: string[] = [];

      const agent = defineAgent({
        name: 'lifecycle-agent',
        description: 'Test',
        capabilities: ['work'],
        onInit: async () => {
          callOrder.push('init');
        },
        onDestroy: async () => {
          callOrder.push('destroy');
        },
        execute: async () => {
          callOrder.push('execute');
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(callOrder).toEqual(['init', 'execute', 'destroy']);
    });

    it('calls onDestroy even when agent throws', async () => {
      const { runner } = makeRunner();
      let destroyed = false;

      const agent = defineAgent({
        name: 'error-agent',
        description: 'Test',
        capabilities: ['work'],
        onDestroy: async () => {
          destroyed = true;
        },
        execute: async () => {
          throw new Error('agent boom');
        },
      });

      await expect(runner.run(agent, makeSubtask(), new AbortController().signal)).rejects.toThrow(
        'agent boom',
      );
      expect(destroyed).toBe(true);
    });

    it('uses agent-specific LLM when provided', async () => {
      const defaultLLM = new MockLLMAdapter();
      const agentLLM = new MockLLMAdapter();
      agentLLM.completeHandler = () => ({
        content: 'from agent LLM',
        tokensUsed: { input: 5, output: 5 },
        finishReason: 'stop',
      });

      const { runner } = makeRunner({ llm: defaultLLM });

      const agent = defineAgent({
        name: 'custom-llm-agent',
        description: 'Test',
        capabilities: ['work'],
        llm: agentLLM,
        execute: async (_subtask, context) => {
          const result = await context.llm.complete([{ role: 'user', content: 'hi' }]);
          return { status: 'success' as const, data: result.content, metadata: { durationMs: 0 } };
        },
      });

      const result = await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(result.data).toBe('from agent LLM');
      expect(agentLLM.calls).toHaveLength(1);
      expect(defaultLLM.calls).toHaveLength(0);
    });

    it('creates a ScopedToolRegistry with agent allowed tools', async () => {
      const { runner } = makeRunner();

      let toolList: string[] = [];
      const agent = defineAgent({
        name: 'scoped-agent',
        description: 'Test',
        capabilities: ['work'],
        tools: ['my-tool'],
        execute: async (_subtask, context) => {
          toolList = context.tools.list();
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      // my-tool isn't registered so list() filters it out
      expect(toolList).toEqual([]);
    });

    it('times out after configured subtaskTimeout', async () => {
      const { runner } = makeRunner({ subtaskTimeout: 50 });

      const agent = defineAgent({
        name: 'slow-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async () => {
          await new Promise((r) => setTimeout(r, 500));
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await expect(runner.run(agent, makeSubtask(), new AbortController().signal)).rejects.toThrow(
        SubtaskTimeoutError,
      );
    });

    it('propagates parent abort signal', async () => {
      const { runner } = makeRunner();
      const controller = new AbortController();

      const agent = defineAgent({
        name: 'abortable-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          // Wait until aborted
          await new Promise((resolve) => {
            context.abortSignal.addEventListener('abort', resolve, { once: true });
          });
          throw new Error('aborted');
        },
      });

      const promise = runner.run(agent, makeSubtask(), controller.signal);
      setTimeout(() => controller.abort(), 20);

      await expect(promise).rejects.toThrow();
    });

    it('emits agent:started and agent:completed events', async () => {
      const { runner, eventBus } = makeRunner();
      const events: string[] = [];

      eventBus.on('agent:started', () => events.push('started'));
      eventBus.on('agent:completed', () => events.push('completed'));

      const agent = defineAgent({
        name: 'event-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async () => ({
          status: 'success' as const,
          data: null,
          metadata: { durationMs: 0 },
        }),
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(events).toEqual(['started', 'completed']);
    });

    it('propagates agent errors', async () => {
      const { runner } = makeRunner();

      const agent = defineAgent({
        name: 'throw-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async () => {
          throw new Error('agent failed');
        },
      });

      await expect(runner.run(agent, makeSubtask(), new AbortController().signal)).rejects.toThrow(
        'agent failed',
      );
    });
  });

  describe('budget tracking (createBudgetTrackedLLM)', () => {
    it('complete() consumes input+output tokens from budget', async () => {
      const llm = new MockLLMAdapter();
      llm.completeHandler = () => ({
        content: 'result',
        tokensUsed: { input: 100, output: 50 },
        finishReason: 'stop',
      });

      const { runner, budgetTracker } = makeRunner({ llm, budget: 10_000 });

      const agent = defineAgent({
        name: 'budget-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          await context.llm.complete([{ role: 'user', content: 'hi' }]);
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(budgetTracker.used()).toBe(150);
    });

    it('stream() consumes tokens from done chunk tokensUsed', async () => {
      const llm = new MockLLMAdapter();
      // Override stream to provide tokensUsed in done chunk
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (llm as any).stream = async function* (messages: any[]) {
        llm.calls.push({ method: 'stream', messages });
        yield { type: 'text' as const, content: 'hello', tokensUsed: { input: 0, output: 0 } };
        yield { type: 'done' as const, content: '', tokensUsed: { input: 30, output: 20 } };
      };

      const { runner, budgetTracker } = makeRunner({ llm, budget: 10_000 });

      const agent = defineAgent({
        name: 'stream-budget-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          const chunks = [];
          for await (const chunk of context.llm.stream([{ role: 'user', content: 'hi' }])) {
            chunks.push(chunk);
          }
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(budgetTracker.used()).toBe(50);
    });

    it('stream() falls back to estimation when done chunk has no tokensUsed', async () => {
      const llm = new MockLLMAdapter();
      // Default mock stream yields done without tokensUsed — should estimate

      const { runner, budgetTracker } = makeRunner({ llm, budget: 10_000 });

      const agent = defineAgent({
        name: 'stream-est-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          for await (const _chunk of context.llm.stream([
            { role: 'user', content: 'test message' },
          ])) {
            // consume
          }
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      // Should have estimated: inputEstimate = "test message".length / 4 = 3, outputChars = "mock".length / 4 = 1 → ceil(3+1) = 4
      expect(budgetTracker.used()).toBeGreaterThan(0);
    });

    it('completeStructured() consumes estimated tokens', async () => {
      const llm = new MockLLMAdapter();
      llm.structuredHandler = () => ({ answer: 'yes' });

      const { runner, budgetTracker } = makeRunner({ llm, budget: 10_000 });

      const { z } = await import('zod');
      const schema = z.object({ answer: z.string() });

      const agent = defineAgent({
        name: 'structured-budget-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          await context.llm.completeStructured([{ role: 'user', content: 'question' }], schema);
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(budgetTracker.used()).toBeGreaterThan(0);
    });

    it('emits budget:warning at 80% and 95% thresholds', async () => {
      const llm = new MockLLMAdapter();
      llm.completeHandler = () => ({
        content: 'result',
        tokensUsed: { input: 40, output: 10 }, // 50 tokens per call
        finishReason: 'stop',
      });

      // Budget of 100 tokens → 80% at 80 tokens, 95% at 95 tokens
      const { runner, eventBus } = makeRunner({ llm, budget: 100 });
      const warnings: Array<{ percentage: number }> = [];

      eventBus.on('budget:warning', (data: { percentage: number }) => {
        warnings.push(data);
      });

      const agent = defineAgent({
        name: 'warning-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          // Call twice: 50 + 50 = 100 tokens total → triggers both 80% and 95%
          await context.llm.complete([{ role: 'user', content: 'a' }]);
          await context.llm.complete([{ role: 'user', content: 'b' }]);
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      // Second call brings usage to 100/100 = 100%, so both 80% and 95% thresholds crossed
      expect(warnings.length).toBe(2);
      expect(warnings[0]!.percentage).toBeGreaterThanOrEqual(80);
      expect(warnings[1]!.percentage).toBeGreaterThanOrEqual(95);
    });

    it('countTokens() delegates without consuming budget', async () => {
      const llm = new MockLLMAdapter();
      const { runner, budgetTracker } = makeRunner({ llm, budget: 10_000 });

      const agent = defineAgent({
        name: 'count-agent',
        description: 'Test',
        capabilities: ['work'],
        execute: async (_subtask, context) => {
          const count = await context.llm.countTokens([{ role: 'user', content: 'hello world' }]);
          expect(count).toBe(11); // MockLLM counts characters
          return { status: 'success' as const, data: null, metadata: { durationMs: 0 } };
        },
      });

      await runner.run(agent, makeSubtask(), new AbortController().signal);

      expect(budgetTracker.used()).toBe(0);
    });
  });

  describe('errorToErrorDetail()', () => {
    it('converts Error with code/retryable to ErrorDetail', () => {
      const err = new Error('coded error');
      (err as unknown as Record<string, unknown>).code = 'MY_CODE';
      (err as unknown as Record<string, unknown>).retryable = true;

      const detail = errorToErrorDetail(err);

      expect(detail.code).toBe('MY_CODE');
      expect(detail.message).toBe('coded error');
      expect(detail.retryable).toBe(true);
      expect(detail.source).toBe('agent');
      expect(detail.original).toBe(err);
    });

    it('converts plain Error to ErrorDetail with defaults', () => {
      const err = new Error('plain error');

      const detail = errorToErrorDetail(err);

      expect(detail.code).toBe('AGENT_FAILURE');
      expect(detail.message).toBe('plain error');
      expect(detail.retryable).toBe(false);
      expect(detail.source).toBe('agent');
    });

    it('converts non-Error to ErrorDetail with string message', () => {
      const detail = errorToErrorDetail('string error');

      expect(detail.code).toBe('AGENT_FAILURE');
      expect(detail.message).toBe('string error');
      expect(detail.retryable).toBe(false);
      expect(detail.source).toBe('agent');
      expect(detail.original).toBe('string error');
    });
  });
});
