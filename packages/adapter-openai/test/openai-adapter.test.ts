import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Message, Logger, StreamChunk } from 'two-layer-cake';
import { LLMError } from 'two-layer-cake';

// ---------------------------------------------------------------------------
// Mock the OpenAI SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockParse = vi.fn();

// Import actual error classes before mocking
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ActualOpenAI = ((await vi.importActual('openai')) as any).default;

vi.mock('openai', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await vi.importActual('openai')) as any;
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    beta = {
      chat: {
        completions: {
          parse: mockParse,
        },
      },
    };
  }
  // Copy static error classes from the real SDK onto the mock
  Object.assign(MockOpenAI, actual.default);
  return {
    ...actual,
    default: MockOpenAI,
  };
});

vi.mock('openai/helpers/zod', () => {
  return {
    zodResponseFormat: vi.fn((schema: unknown, name: string) => ({
      type: 'json_schema',
      json_schema: { name, schema },
    })),
  };
});

// Import after mock setup
import { OpenAIAdapter } from '../src/openai-adapter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testMessages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello, world!' },
];

function createMockLogger(): Logger & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { debug: [], info: [], warn: [], error: [] };
  return {
    calls,
    debug: (...args: unknown[]) => {
      calls.debug.push(args);
    },
    info: (...args: unknown[]) => {
      calls.info.push(args);
    },
    warn: (...args: unknown[]) => {
      calls.warn.push(args);
    },
    error: (...args: unknown[]) => {
      calls.error.push(args);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter({
      model: 'gpt-4o',
      apiKey: 'test-key',
      retry: { maxRetries: 0 },
    });
  });

  describe('complete()', () => {
    it('should send messages and return a CompletionResult', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Hello back!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await adapter.complete(testMessages);

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hello, world!' },
          ],
        }),
        expect.any(Object),
      );

      expect(result).toEqual({
        content: 'Hello back!',
        tokensUsed: { input: 10, output: 5 },
        finishReason: 'stop',
      });
    });

    it('should map "length" finish reason correctly', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Partial...' },
            finish_reason: 'length',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 100 },
      });

      const result = await adapter.complete(testMessages);
      expect(result.finishReason).toBe('length');
    });

    it('should map "tool_calls" finish reason to "tool_use"', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: '' },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await adapter.complete(testMessages);
      expect(result.finishReason).toBe('tool_use');
    });

    it('should forward completion options', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });

      await adapter.complete(testMessages, {
        temperature: 0.5,
        maxTokens: 100,
        stopSequences: ['STOP'],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
          max_tokens: 100,
          stop: ['STOP'],
        }),
        expect.any(Object),
      );
    });

    it('should handle empty content gracefully', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: null },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 0 },
      });

      const result = await adapter.complete(testMessages);
      expect(result.content).toBe('');
    });
  });

  describe('stream()', () => {
    it('should yield text chunks and a done chunk with usage', async () => {
      const asyncChunks = (async function* () {
        yield {
          choices: [{ delta: { content: 'Hello' } }],
          usage: null,
        };
        yield {
          choices: [{ delta: { content: ' world' } }],
          usage: null,
        };
        yield {
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 10, completion_tokens: 6 },
        };
      })();

      mockCreate.mockResolvedValue(asyncChunks);

      const chunks: StreamChunk[] = [];
      for await (const chunk of adapter.stream(testMessages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'text', content: 'Hello' });
      expect(chunks[1]).toEqual({ type: 'text', content: ' world' });
      expect(chunks[2]).toEqual({
        type: 'done',
        content: '',
        tokensUsed: { input: 10, output: 6 },
      });
    });

    it('should pass stream: true and stream_options', async () => {
      const asyncChunks = (async function* () {
        yield {
          choices: [{ delta: { content: 'Hi' } }],
          usage: null,
        };
      })();

      mockCreate.mockResolvedValue(asyncChunks);

      const chunks: StreamChunk[] = [];
      for await (const chunk of adapter.stream(testMessages)) {
        chunks.push(chunk);
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
          stream_options: { include_usage: true },
        }),
        expect.any(Object),
      );
    });

    it('should skip chunks without delta content', async () => {
      const asyncChunks = (async function* () {
        yield { choices: [{ delta: { role: 'assistant' } }], usage: null };
        yield { choices: [{ delta: { content: 'Data' } }], usage: null };
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 1 } };
      })();

      mockCreate.mockResolvedValue(asyncChunks);

      const chunks: StreamChunk[] = [];
      for await (const chunk of adapter.stream(testMessages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2); // 1 text + 1 done
      expect(chunks[0]).toEqual({ type: 'text', content: 'Data' });
    });
  });

  describe('completeStructured()', () => {
    it('should use response_format with zodResponseFormat and return parsed output', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      mockParse.mockResolvedValue({
        choices: [
          {
            message: {
              parsed: { name: 'Alice', age: 30 },
              content: '{"name":"Alice","age":30}',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 15 },
      });

      const result = await adapter.completeStructured(testMessages, schema);

      expect(result).toEqual({ name: 'Alice', age: 30 });
      expect(mockParse).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: expect.objectContaining({
            type: 'json_schema',
          }),
        }),
        expect.any(Object),
      );
    });

    it('should fall back to parsing raw content if parsed is null', async () => {
      const schema = z.object({
        value: z.string(),
      });

      mockParse.mockResolvedValue({
        choices: [
          {
            message: {
              parsed: null,
              content: '{"value":"fallback"}',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await adapter.completeStructured(testMessages, schema);
      expect(result).toEqual({ value: 'fallback' });
    });

    it('should throw if no content is available at all', async () => {
      const schema = z.object({ value: z.string() });

      mockParse.mockResolvedValue({
        choices: [
          {
            message: {
              parsed: null,
              content: null,
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });

      await expect(adapter.completeStructured(testMessages, schema)).rejects.toThrow(
        'OpenAI did not return structured output',
      );
    });
  });

  describe('countTokens()', () => {
    it('should estimate tokens with improved heuristic', async () => {
      const count = await adapter.countTokens(testMessages);

      // 3 (base) + 2 messages * (4 overhead + 1 role)
      // 'You are a helpful assistant.' = 30 chars → ceil(30/3.5) = 9
      // 'Hello, world!' = 13 chars → ceil(13/3.5) = 4
      // Total = 3 + (4+1+9) + (4+1+4) = 3 + 14 + 9 = 25 (note: 4+1+4 = 9 not 10)
      expect(count).toBe(25);
    });

    it('should handle empty messages', async () => {
      const count = await adapter.countTokens([]);
      // 3 (reply priming overhead) + no messages = 3
      expect(count).toBe(3);
    });

    it('should handle a single message', async () => {
      const count = await adapter.countTokens([{ role: 'user', content: 'Hello' }]);

      // 3 (base) + 4 (overhead) + 1 (role) + ceil(5/3.5)=2 = 10
      expect(count).toBe(10);
    });
  });

  describe('constructor defaults', () => {
    it('should use default maxTokens when not specified', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      await adapter.complete([{ role: 'user', content: 'hi' }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 4096 }),
        expect.any(Object),
      );
    });

    it('should use custom maxTokens from constructor', async () => {
      const customAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        maxTokens: 1024,
        retry: { maxRetries: 0 },
      });

      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      await customAdapter.complete([{ role: 'user', content: 'hi' }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 1024 }),
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // Hardening tests
  // =========================================================================

  describe('error classification & retry', () => {
    it('401 → throws LLMError with LLM_AUTH_ERROR, no retry', async () => {
      const OpenAI = ActualOpenAI;
      const authError = new OpenAI.AuthenticationError(
        401,
        { error: { message: 'bad key', type: 'auth_error', code: null, param: null } },
        'bad key',
        {},
      );
      mockCreate.mockRejectedValue(authError);

      const retryAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      try {
        await retryAdapter.complete(testMessages);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LLMError);
        const llmErr = err as InstanceType<typeof LLMError>;
        expect(llmErr.code).toBe('LLM_AUTH_ERROR');
        expect(llmErr.provider).toBe('openai');
        expect(llmErr.httpStatus).toBe(401);
      }
      // Should only be called once (no retries for non-retryable errors)
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('429 → retries and succeeds on 2nd attempt', async () => {
      const OpenAI = ActualOpenAI;
      const rateLimitError = new OpenAI.RateLimitError(
        429,
        { error: { message: 'rate limited', type: 'rate_limit_error', code: null, param: null } },
        'rate limited',
        {},
      );

      mockCreate.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });

      const retryAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const result = await retryAdapter.complete(testMessages);
      expect(result.content).toBe('ok');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('500 → retries and succeeds on 2nd attempt', async () => {
      const OpenAI = ActualOpenAI;
      const serverError = new OpenAI.InternalServerError(
        500,
        { error: { message: 'internal error', type: 'server_error', code: null, param: null } },
        'internal error',
        {},
      );

      mockCreate.mockRejectedValueOnce(serverError).mockResolvedValueOnce({
        choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });

      const retryAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const result = await retryAdapter.complete(testMessages);
      expect(result.content).toBe('recovered');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('network error → retries', async () => {
      const OpenAI = ActualOpenAI;
      const connError = new OpenAI.APIConnectionError({ message: 'network failed' });

      mockCreate.mockRejectedValueOnce(connError).mockResolvedValueOnce({
        choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });

      const retryAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const result = await retryAdapter.complete(testMessages);
      expect(result.content).toBe('recovered');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('400 → throws immediately, no retry', async () => {
      const OpenAI = ActualOpenAI;
      const badReqError = new OpenAI.BadRequestError(
        400,
        { error: { message: 'bad', type: 'invalid_request_error', code: null, param: null } },
        'bad',
        {},
      );

      const retryAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      mockCreate.mockRejectedValue(badReqError);
      await expect(retryAdapter.complete(testMessages)).rejects.toThrow(LLMError);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('exhausts retries → throws final error', async () => {
      const OpenAI = ActualOpenAI;
      const serverError = new OpenAI.InternalServerError(
        500,
        { error: { message: 'persistent failure', type: 'server_error', code: null, param: null } },
        'persistent failure',
        {},
      );
      mockCreate.mockRejectedValue(serverError);

      const retryAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      await expect(retryAdapter.complete(testMessages)).rejects.toThrow();
      // Initial + 2 retries = 3 calls
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe('AbortSignal', () => {
    it('signal forwarded to SDK call', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      const controller = new AbortController();
      await adapter.complete(testMessages, { signal: controller.signal });

      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs[1]).toBeDefined();
      expect(callArgs[1].signal).toBeDefined();
    });

    it('user abort propagates', async () => {
      const controller = new AbortController();
      controller.abort(new Error('user cancelled'));

      mockCreate.mockRejectedValue(new Error('aborted'));

      await expect(adapter.complete(testMessages, { signal: controller.signal })).rejects.toThrow();
    });
  });

  describe('logging', () => {
    it('debug messages logged on success', async () => {
      const logger = createMockLogger();
      const loggingAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        logger,
        retry: { maxRetries: 0 },
      });

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      });

      await loggingAdapter.complete(testMessages);

      expect(logger.calls.debug.length).toBeGreaterThanOrEqual(2);
      expect(logger.calls.debug[0][0]).toContain('complete() called');
    });

    it('warn messages logged on error', async () => {
      const OpenAI = ActualOpenAI;
      const logger = createMockLogger();
      const loggingAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        logger,
        retry: { maxRetries: 0 },
      });

      const authError = new OpenAI.AuthenticationError(
        401,
        { error: { message: 'bad key', type: 'auth_error', code: null, param: null } },
        'bad key',
        {},
      );
      mockCreate.mockRejectedValue(authError);

      await expect(loggingAdapter.complete(testMessages)).rejects.toThrow();

      expect(logger.calls.warn.length).toBeGreaterThanOrEqual(1);
      expect(logger.calls.warn[0][0]).toContain('error');
    });
  });

  describe('timeout', () => {
    it('configured timeout passed to signal', async () => {
      const timeoutAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        apiKey: 'test-key',
        timeout: 5000,
        retry: { maxRetries: 0 },
      });

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      await timeoutAdapter.complete(testMessages);

      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs[1]).toBeDefined();
      expect(callArgs[1].signal).toBeDefined();
    });
  });
});
