import { describe, it, expect, vi } from 'vitest';
import { researcherAgent } from '../../src/agents/built-in/researcher.js';
import { analyzerAgent } from '../../src/agents/built-in/analyzer.js';
import {
  answerGeneratorAgent,
  aggregateResults,
} from '../../src/agents/built-in/answer-generator.js';
import { MockLLMAdapter } from '../helpers/mock-llm.js';
import type { AgentContext, Subtask, SubtaskResult } from '../../src/types/index.js';

function makeSubtask(overrides?: Partial<Subtask>): Subtask {
  return {
    id: 'sub-1',
    description: 'Analyze the data',
    agentType: 'researcher',
    dependsOn: [],
    priority: 'medium',
    status: 'PENDING',
    ...overrides,
  };
}

function makeContext(llmResponse = 'LLM response'): AgentContext {
  const llm = new MockLLMAdapter();
  llm.completeHandler = () => ({
    content: llmResponse,
    tokensUsed: { input: 20, output: 30 },
    finishReason: 'stop',
  });

  return {
    llm,
    tools: {
      invoke: vi.fn(),
      list: () => ['web-search', 'http-fetch', 'text-extraction'],
      has: (name: string) => ['web-search', 'http-fetch', 'text-extraction'].includes(name),
    },
    abortSignal: new AbortController().signal,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    emitEvent: vi.fn(),
  };
}

describe('researcherAgent', () => {
  it('calls llm.complete() with system and user messages', async () => {
    const context = makeContext('Research findings');
    const subtask = makeSubtask({ description: 'Research topic X' });

    await researcherAgent.execute(subtask, context);

    const llm = context.llm as MockLLMAdapter;
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.method).toBe('complete');

    const messages = llm.calls[0]!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
  });

  it('includes tool list in system message', async () => {
    const context = makeContext();
    const subtask = makeSubtask();

    await researcherAgent.execute(subtask, context);

    const llm = context.llm as MockLLMAdapter;
    const systemMsg = llm.calls[0]!.messages[0]!.content;
    expect(systemMsg).toContain('web-search');
    expect(systemMsg).toContain('http-fetch');
    expect(systemMsg).toContain('text-extraction');
  });

  it('appends contextFromPrevious to user message when present', async () => {
    const context = makeContext();
    const subtask = makeSubtask({
      contextFromPrevious: 'Previous research data',
    });

    await researcherAgent.execute(subtask, context);

    const llm = context.llm as MockLLMAdapter;
    const userMsg = llm.calls[0]!.messages[1]!.content;
    expect(userMsg).toContain('Previous research data');
  });

  it('returns success result with LLM content and token metadata', async () => {
    const context = makeContext('Research output');
    const subtask = makeSubtask();

    const result = await researcherAgent.execute(subtask, context);

    expect(result.status).toBe('success');
    expect(result.data).toBe('Research output');
    expect(result.metadata!.llmTokensUsed).toBe(50); // 20 input + 30 output
  });
});

describe('analyzerAgent', () => {
  it('calls llm.complete() with analyzer-specific system message', async () => {
    const context = makeContext('Analysis results');
    const subtask = makeSubtask({ agentType: 'analyzer' });

    const result = await analyzerAgent.execute(subtask, context);

    const llm = context.llm as MockLLMAdapter;
    expect(llm.calls).toHaveLength(1);
    const systemMsg = llm.calls[0]!.messages[0]!.content;
    expect(systemMsg).toContain('analysis');

    expect(result.status).toBe('success');
    expect(result.data).toBe('Analysis results');
  });

  it('appends contextFromPrevious when present', async () => {
    const context = makeContext();
    const subtask = makeSubtask({
      agentType: 'analyzer',
      contextFromPrevious: 'Data to analyze',
    });

    await analyzerAgent.execute(subtask, context);

    const llm = context.llm as MockLLMAdapter;
    const userMsg = llm.calls[0]!.messages[1]!.content;
    expect(userMsg).toContain('Data to analyze');
  });
});

describe('answerGeneratorAgent', () => {
  it('calls llm.complete() with synthesis system message', async () => {
    const context = makeContext('Final answer');
    const subtask = makeSubtask({ agentType: 'answer-generator' });

    const result = await answerGeneratorAgent.execute(subtask, context);

    const llm = context.llm as MockLLMAdapter;
    expect(llm.calls).toHaveLength(1);
    const systemMsg = llm.calls[0]!.messages[0]!.content;
    expect(systemMsg).toContain('synthesize');

    expect(result.status).toBe('success');
    expect(result.data).toBe('Final answer');
  });

  it('appends contextFromPrevious as subtask results to aggregate', async () => {
    const context = makeContext();
    const subtask = makeSubtask({
      agentType: 'answer-generator',
      contextFromPrevious: '[task-1]: result A\n\n[task-2]: result B',
    });

    await answerGeneratorAgent.execute(subtask, context);

    const llm = context.llm as MockLLMAdapter;
    const userMsg = llm.calls[0]!.messages[1]!.content;
    expect(userMsg).toContain('Subtask results to aggregate');
    expect(userMsg).toContain('[task-1]: result A');
  });
});

describe('aggregateResults()', () => {
  it('aggregates successful results into [subtaskId]: data format', () => {
    const results = new Map<string, SubtaskResult<unknown>>([
      ['task-1', { status: 'success', data: 'Result A', metadata: { durationMs: 10 } }],
      ['task-2', { status: 'success', data: 'Result B', metadata: { durationMs: 20 } }],
    ]);

    const output = aggregateResults(results);

    expect(output).toContain('[task-1]: Result A');
    expect(output).toContain('[task-2]: Result B');
  });

  it('includes partial status results', () => {
    const results = new Map<string, SubtaskResult<unknown>>([
      ['task-1', { status: 'partial', data: 'Partial data', metadata: { durationMs: 10 } }],
    ]);

    const output = aggregateResults(results);
    expect(output).toContain('[task-1]: Partial data');
  });

  it('excludes failed status results', () => {
    const results = new Map<string, SubtaskResult<unknown>>([
      ['task-1', { status: 'success', data: 'OK', metadata: { durationMs: 10 } }],
      ['task-2', { status: 'failed', data: null, errors: [], metadata: { durationMs: 10 } }],
    ]);

    const output = aggregateResults(results);
    expect(output).toContain('[task-1]: OK');
    expect(output).not.toContain('task-2');
  });

  it('JSON.stringifies non-string data', () => {
    const results = new Map<string, SubtaskResult<unknown>>([
      ['task-1', { status: 'success', data: { key: 'value' }, metadata: { durationMs: 10 } }],
    ]);

    const output = aggregateResults(results);
    expect(output).toContain('[task-1]: {"key":"value"}');
  });

  it('returns empty string for empty map', () => {
    const results = new Map<string, SubtaskResult<unknown>>();
    expect(aggregateResults(results)).toBe('');
  });
});
