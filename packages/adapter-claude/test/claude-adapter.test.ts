import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Message } from 'two-layer-cake';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockCountTokens = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: mockStream,
        countTokens: mockCountTokens,
      };
    },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new ClaudeAdapter({ model: 'claude-sonnet-4-20250514', apiKey: 'test-key' });
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

      const chunks: import('two-layer-cake').StreamChunk[] = [];
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
      );
    });

    it('should throw if no tool_use block is returned', async () => {
      const schema = z.object({ value: z.string() });

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Some text' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      await expect(
        adapter.completeStructured(testMessages, schema),
      ).rejects.toThrow('Claude did not return a tool_use block');
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

      await expect(
        adapter.completeStructured(testMessages, schema),
      ).rejects.toThrow();
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
      );
    });

    it('should use custom maxTokens from constructor', async () => {
      const customAdapter = new ClaudeAdapter({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 1024,
      });

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await customAdapter.complete([{ role: 'user', content: 'hi' }]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 1024 }),
      );
    });
  });
});
