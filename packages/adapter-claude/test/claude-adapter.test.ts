import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Message, Logger, StreamChunk } from 'two-layer-cake';
import { LLMError } from 'two-layer-cake';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockCountTokens = vi.fn();

// Import actual error classes before mocking
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ActualAnthropic = ((await vi.importActual('@anthropic-ai/sdk')) as any).default;

vi.mock('@anthropic-ai/sdk', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await vi.importActual('@anthropic-ai/sdk')) as any;
  class MockAnthropic {
    messages = {
      create: mockCreate,
      stream: mockStream,
      countTokens: mockCountTokens,
    };
  }
  // Copy static error classes from the real SDK onto the mock
  Object.assign(MockAnthropic, actual.default);
  return {
    ...actual,
    default: MockAnthropic,
  };
});

// Import after mock setup
import { ClaudeAdapter } from '../src/claude-adapter.js';

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

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter({
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-key',
      retry: { maxRetries: 0 },
    });
  });

  describe('complete()', () => {
    it('should send messages and return a CompletionResult', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello back!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const result = await adapter.complete(testMessages);

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          system: 'You are a helpful assistant.',
          messages: [{ role: 'user', content: 'Hello, world!' }],
        }),
        expect.any(Object),
      );

      expect(result).toEqual({
        content: 'Hello back!',
        tokensUsed: { input: 10, output: 5 },
        finishReason: 'stop',
      });
    });

    it('should map max_tokens stop reason to "length"', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Partial...' }],
        usage: { input_tokens: 10, output_tokens: 100 },
        stop_reason: 'max_tokens',
      });

      const result = await adapter.complete(testMessages);
      expect(result.finishReason).toBe('length');
    });

    it('should forward completion options', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 1 },
        stop_reason: 'end_turn',
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
          stop_sequences: ['STOP'],
        }),
        expect.any(Object),
      );
    });

    it('should concatenate multiple text blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
        usage: { input_tokens: 10, output_tokens: 8 },
        stop_reason: 'end_turn',
      });

      const result = await adapter.complete(testMessages);
      expect(result.content).toBe('Part 1. Part 2.');
    });
  });

  describe('stream()', () => {
    it('should yield text chunks and a done chunk with usage', async () => {
      const mockFinalMessage = vi.fn().mockResolvedValue({
        usage: { input_tokens: 10, output_tokens: 6 },
      });

      const asyncEvents = (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
      })();

      mockStream.mockReturnValue({
        [Symbol.asyncIterator]: () => asyncEvents[Symbol.asyncIterator](),
        finalMessage: mockFinalMessage,
      });

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

    it('should skip non-text-delta events', async () => {
      const mockFinalMessage = vi.fn().mockResolvedValue({
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      const asyncEvents = (async function* () {
        yield { type: 'message_start', message: {} };
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } };
        yield { type: 'content_block_stop', index: 0 };
      })();

      mockStream.mockReturnValue({
        [Symbol.asyncIterator]: () => asyncEvents[Symbol.asyncIterator](),
        finalMessage: mockFinalMessage,
      });

      const chunks: StreamChunk[] = [];
      for await (const chunk of adapter.stream(testMessages)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2); // 1 text + 1 done
      expect(chunks[0]).toEqual({ type: 'text', content: 'Hi' });
    });
  });

  describe('completeStructured()', () => {
    it('should use tool_use to get structured output and parse it', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'structured_output',
            input: { name: 'Alice', age: 30 },
          },
        ],
        usage: { input_tokens: 20, output_tokens: 15 },
        stop_reason: 'tool_use',
      });

      const result = await adapter.completeStructured(testMessages, schema);

      expect(result).toEqual({ name: 'Alice', age: 30 });

      // Verify tool definition was sent
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              name: 'structured_output',
              input_schema: expect.objectContaining({
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'number' },
                },
              }),
            }),
          ],
          tool_choice: { type: 'tool', name: 'structured_output' },
        }),
        expect.any(Object),
      );
    });

    it('should throw if no tool_use block is returned', async () => {
      const schema = z.object({ value: z.string() });

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Some text' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      await expect(adapter.completeStructured(testMessages, schema)).rejects.toThrow(
        'Claude did not return a tool_use block',
      );
    });

    it('should throw if tool_use input fails Zod validation', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'structured_output',
            input: { name: 'Alice', age: 'not-a-number' },
          },
        ],
        usage: { input_tokens: 20, output_tokens: 15 },
        stop_reason: 'tool_use',
      });

      await expect(adapter.completeStructured(testMessages, schema)).rejects.toThrow();
    });
  });

  describe('countTokens()', () => {
    it('should use the API to count tokens', async () => {
      mockCountTokens.mockResolvedValue({ input_tokens: 42 });

      const count = await adapter.countTokens(testMessages);

      expect(count).toBe(42);
      expect(mockCountTokens).toHaveBeenCalledOnce();
    });

    it('should fall back to estimation if API call fails', async () => {
      mockCountTokens.mockRejectedValue(new Error('API unavailable'));

      const count = await adapter.countTokens(testMessages);

      // 'You are a helpful assistant.' = 30 chars
      // 'Hello, world!' = 13 chars
      // Total = 43 chars, ceil(43/4) = 11
      expect(count).toBe(11);
    });
  });

  describe('constructor defaults', () => {
    it('should use default maxTokens when not specified', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await adapter.complete([{ role: 'user', content: 'hi' }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 4096 }),
        expect.any(Object),
      );
    });

    it('should use custom maxTokens from constructor', async () => {
      const customAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
        retry: { maxRetries: 0 },
      });

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
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
      const Anthropic = ActualAnthropic;
      const authError = new Anthropic.AuthenticationError(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
        'bad key',
        {},
      );
      mockCreate.mockRejectedValue(authError);

      const retryAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
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
        expect(llmErr.provider).toBe('anthropic');
        expect(llmErr.httpStatus).toBe(401);
      }
      // Should only be called once (no retries for non-retryable errors)
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('429 → retries and succeeds on 2nd attempt', async () => {
      const Anthropic = ActualAnthropic;
      const rateLimitError = new Anthropic.RateLimitError(
        429,
        { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
        'rate limited',
        {},
      );

      mockCreate.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      const retryAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const result = await retryAdapter.complete(testMessages);
      expect(result.content).toBe('ok');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('500 → retries and succeeds on 2nd attempt', async () => {
      const Anthropic = ActualAnthropic;
      const serverError = new Anthropic.InternalServerError(
        500,
        { type: 'error', error: { type: 'api_error', message: 'internal error' } },
        'internal error',
        {},
      );

      mockCreate.mockRejectedValueOnce(serverError).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'recovered' }],
        usage: { input_tokens: 5, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      const retryAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const result = await retryAdapter.complete(testMessages);
      expect(result.content).toBe('recovered');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('network error → retries', async () => {
      const Anthropic = ActualAnthropic;
      const connError = new Anthropic.APIConnectionError({ message: 'network failed' });

      mockCreate.mockRejectedValueOnce(connError).mockResolvedValueOnce({
        content: [{ type: 'text', text: 'recovered' }],
        usage: { input_tokens: 5, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      const retryAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const result = await retryAdapter.complete(testMessages);
      expect(result.content).toBe('recovered');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('400 → throws immediately, no retry', async () => {
      const Anthropic = ActualAnthropic;
      const badReqError = new Anthropic.BadRequestError(
        400,
        { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } },
        'bad',
        {},
      );
      mockCreate.mockRejectedValue(badReqError);

      const retryAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      await expect(retryAdapter.complete(testMessages)).rejects.toThrow(LLMError);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('exhausts retries → throws final error', async () => {
      const Anthropic = ActualAnthropic;
      const serverError = new Anthropic.InternalServerError(
        500,
        { type: 'error', error: { type: 'api_error', message: 'persistent failure' } },
        'persistent failure',
        {},
      );
      mockCreate.mockRejectedValue(serverError);

      const retryAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
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
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      const controller = new AbortController();
      await adapter.complete(testMessages, { signal: controller.signal });

      // The second argument to create should contain a signal
      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs[1]).toBeDefined();
      expect(callArgs[1].signal).toBeDefined();
    });

    it('user abort propagates', async () => {
      const controller = new AbortController();
      controller.abort(new Error('user cancelled'));

      mockCreate.mockRejectedValue(new Error('aborted'));

      // With an already-aborted signal, the request should fail
      await expect(adapter.complete(testMessages, { signal: controller.signal })).rejects.toThrow();
    });
  });

  describe('logging', () => {
    it('debug messages logged on success', async () => {
      const logger = createMockLogger();
      const loggingAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
        logger,
        retry: { maxRetries: 0 },
      });

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await loggingAdapter.complete(testMessages);

      expect(logger.calls.debug.length).toBeGreaterThanOrEqual(2);
      expect(logger.calls.debug[0][0]).toContain('complete() called');
    });

    it('warn messages logged on error', async () => {
      const Anthropic = ActualAnthropic;
      const logger = createMockLogger();
      const loggingAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
        logger,
        retry: { maxRetries: 0 },
      });

      const authError = new Anthropic.AuthenticationError(
        401,
        { type: 'error', error: { type: 'authentication_error', message: 'bad key' } },
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
      const timeoutAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
        timeout: 5000,
        retry: { maxRetries: 0 },
      });

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await timeoutAdapter.complete(testMessages);

      // Verify signal was passed (created from timeout)
      const callArgs = mockCreate.mock.calls[0];
      expect(callArgs[1]).toBeDefined();
      expect(callArgs[1].signal).toBeDefined();
    });
  });
});
