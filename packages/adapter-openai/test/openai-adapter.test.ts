import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Message } from 'two-layer-cake';

// ---------------------------------------------------------------------------
// Mock the OpenAI SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockParse = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
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
    },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new OpenAIAdapter({ model: 'gpt-4o', apiKey: 'test-key' });
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

      const chunks: import('two-layer-cake').StreamChunk[] = [];
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

      const chunks: import('two-layer-cake').StreamChunk[] = [];
      for await (const chunk of adapter.stream(testMessages)) {
        chunks.push(chunk);
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true,
          stream_options: { include_usage: true },
        }),
      );
    });

    it('should skip chunks without delta content', async () => {
      const asyncChunks = (async function* () {
        yield { choices: [{ delta: { role: 'assistant' } }], usage: null };
        yield { choices: [{ delta: { content: 'Data' } }], usage: null };
        yield { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 1 } };
      })();

      mockCreate.mockResolvedValue(asyncChunks);

      const chunks: import('two-layer-cake').StreamChunk[] = [];
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

      await expect(
        adapter.completeStructured(testMessages, schema),
      ).rejects.toThrow('OpenAI did not return structured output');
    });
  });

  describe('countTokens()', () => {
    it('should estimate tokens based on character count', async () => {
      const count = await adapter.countTokens(testMessages);

      // 'You are a helpful assistant.' = 30 chars
      // 'Hello, world!' = 13 chars
      // Total chars = 43, ceil(43/4) = 11
      // Overhead: 2 messages * 4 = 8
      // Total = 11 + 8 = 19
      expect(count).toBe(19);
    });

    it('should handle empty messages', async () => {
      const count = await adapter.countTokens([]);
      expect(count).toBe(0);
    });

    it('should handle a single message', async () => {
      const count = await adapter.countTokens([
        { role: 'user', content: 'Hello' },
      ]);

      // 'Hello' = 5 chars, ceil(5/4) = 2
      // Overhead: 1 message * 4 = 4
      // Total = 2 + 4 = 6
      expect(count).toBe(6);
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
      );
    });

    it('should use custom maxTokens from constructor', async () => {
      const customAdapter = new OpenAIAdapter({
        model: 'gpt-4o',
        maxTokens: 1024,
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
      );
    });
  });
});
