import Anthropic from '@anthropic-ai/sdk';
import type { ZodType, ZodTypeDef } from 'zod';
import type {
  LLMAdapter,
  Message,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
  Logger,
} from 'two-layer-cake';
import { retry, LLMError } from 'two-layer-cake';
import { zodToJsonSchema } from './zod-to-json-schema.js';
import { classifyError, isRetryable } from './classify-error.js';
import { createRequestSignal } from './create-signal.js';

export interface ClaudeAdapterConfig {
  model: string;
  apiKey?: string;
  maxTokens?: number;
  logger?: Logger;
  timeout?: number;
  retry?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
}

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY = 1000;
const DEFAULT_MAX_DELAY = 30_000;

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export class ClaudeAdapter implements LLMAdapter {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly logger: Logger;
  private readonly timeout: number;
  private readonly retryConfig: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };

  constructor(config: ClaudeAdapterConfig) {
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.logger = config.logger ?? noopLogger;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: config.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY,
      maxDelayMs: config.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY,
    };
    this.client = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: 0, // Disable SDK built-in retry; we manage retries ourselves
    });
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const { systemMessages, userMessages } = splitMessages(messages);
    const signal = createRequestSignal(options?.signal, this.timeout);

    this.logger.debug('ClaudeAdapter.complete() called', { model: this.model });

    try {
      return await retry(
        async () => {
          const response = await this.client.messages.create(
            {
              model: this.model,
              max_tokens: options?.maxTokens ?? this.maxTokens,
              system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
              messages: userMessages,
              temperature: options?.temperature,
              stop_sequences: options?.stopSequences,
            },
            { signal },
          );

          const textContent = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('');

          this.logger.debug('ClaudeAdapter.complete() succeeded', {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          });

          return {
            content: textContent,
            tokensUsed: {
              input: response.usage.input_tokens,
              output: response.usage.output_tokens,
            },
            finishReason: mapStopReason(response.stop_reason),
          };
        },
        {
          maxRetries: this.retryConfig.maxRetries,
          baseDelayMs: this.retryConfig.baseDelayMs,
          maxDelayMs: this.retryConfig.maxDelayMs,
          signal: options?.signal,
          shouldRetry: isRetryable,
          onRetry: (_error, attempt) => {
            this.logger.warn(`ClaudeAdapter.complete() retry attempt ${attempt}`);
          },
        },
      );
    } catch (error) {
      const detail = classifyError(error);
      this.logger.warn('ClaudeAdapter.complete() error', {
        code: detail.code,
        retryable: detail.retryable,
      });
      throw new LLMError({ ...detail, provider: 'anthropic', httpStatus: getHttpStatus(error) });
    }
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const { systemMessages, userMessages } = splitMessages(messages);
    const signal = createRequestSignal(options?.signal, this.timeout);

    this.logger.debug('ClaudeAdapter.stream() called', { model: this.model });

    // Retry only the connection establishment, not mid-stream
    let stream: ReturnType<typeof this.client.messages.stream>;
    try {
      stream = await retry(
        async () => {
          return this.client.messages.stream(
            {
              model: this.model,
              max_tokens: options?.maxTokens ?? this.maxTokens,
              system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
              messages: userMessages,
              temperature: options?.temperature,
              stop_sequences: options?.stopSequences,
            },
            { signal },
          );
        },
        {
          maxRetries: this.retryConfig.maxRetries,
          baseDelayMs: this.retryConfig.baseDelayMs,
          maxDelayMs: this.retryConfig.maxDelayMs,
          signal: options?.signal,
          shouldRetry: isRetryable,
          onRetry: (_error, attempt) => {
            this.logger.warn(`ClaudeAdapter.stream() retry attempt ${attempt}`);
          },
        },
      );
    } catch (error) {
      const detail = classifyError(error);
      this.logger.warn('ClaudeAdapter.stream() connection error', {
        code: detail.code,
        retryable: detail.retryable,
      });
      throw new LLMError({ ...detail, provider: 'anthropic', httpStatus: getHttpStatus(error) });
    }

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield {
          type: 'text',
          content: event.delta.text,
        };
      }
    }

    const finalMessage = await stream.finalMessage();

    this.logger.debug('ClaudeAdapter.stream() completed', {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    });

    yield {
      type: 'done',
      content: '',
      tokensUsed: {
        input: finalMessage.usage.input_tokens,
        output: finalMessage.usage.output_tokens,
      },
    };
  }

  async completeStructured<TOutput, TDef extends ZodTypeDef = ZodTypeDef, TInput = TOutput>(
    messages: Message[],
    schema: ZodType<TOutput, TDef, TInput>,
    options?: CompletionOptions,
  ): Promise<TOutput> {
    const { systemMessages, userMessages } = splitMessages(messages);
    const signal = createRequestSignal(options?.signal, this.timeout);
    const jsonSchema = zodToJsonSchema(schema);

    this.logger.debug('ClaudeAdapter.completeStructured() called', { model: this.model });

    try {
      return await retry(
        async () => {
          const response = await this.client.messages.create(
            {
              model: this.model,
              max_tokens: options?.maxTokens ?? this.maxTokens,
              system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
              messages: userMessages,
              temperature: options?.temperature,
              stop_sequences: options?.stopSequences,
              tools: [
                {
                  name: 'structured_output',
                  description: 'Provide the structured output matching the required schema.',
                  input_schema: jsonSchema as Anthropic.Tool['input_schema'],
                },
              ],
              tool_choice: { type: 'tool', name: 'structured_output' },
            },
            { signal },
          );

          const toolUseBlock = response.content.find(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
          );

          if (!toolUseBlock) {
            throw new Error('Claude did not return a tool_use block for structured output');
          }

          this.logger.debug('ClaudeAdapter.completeStructured() succeeded');
          return schema.parse(toolUseBlock.input);
        },
        {
          maxRetries: this.retryConfig.maxRetries,
          baseDelayMs: this.retryConfig.baseDelayMs,
          maxDelayMs: this.retryConfig.maxDelayMs,
          signal: options?.signal,
          shouldRetry: isRetryable,
          onRetry: (_error, attempt) => {
            this.logger.warn(`ClaudeAdapter.completeStructured() retry attempt ${attempt}`);
          },
        },
      );
    } catch (error) {
      if (error instanceof LLMError) throw error;
      // Non-API errors (e.g., missing tool_use block, Zod validation) pass through
      const detail = classifyError(error);
      if (detail.code === 'LLM_UNKNOWN' && !(error instanceof Anthropic.APIError)) throw error;
      this.logger.warn('ClaudeAdapter.completeStructured() error', {
        code: detail.code,
        retryable: detail.retryable,
      });
      throw new LLMError({ ...detail, provider: 'anthropic', httpStatus: getHttpStatus(error) });
    }
  }

  async countTokens(messages: Message[]): Promise<number> {
    const { systemMessages, userMessages } = splitMessages(messages);

    this.logger.debug('ClaudeAdapter.countTokens() called');

    try {
      const result = await this.client.messages.countTokens({
        model: this.model,
        system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
        messages: userMessages,
      });
      return result.input_tokens;
    } catch {
      // Fall back to rough estimation: ~4 chars per token
      this.logger.debug('ClaudeAdapter.countTokens() falling back to estimation');
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      return Math.ceil(totalChars / 4);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SplitResult {
  systemMessages: string[];
  userMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function splitMessages(messages: Message[]): SplitResult {
  const systemMessages: string[] = [];
  const userMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg.content);
    } else {
      userMessages.push({ role: msg.role, content: msg.content });
    }
  }

  return { systemMessages, userMessages };
}

function mapStopReason(reason: string | null): CompletionResult['finishReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'error';
  }
}

function getHttpStatus(error: unknown): number | undefined {
  if (error instanceof Anthropic.APIError) {
    return error.status;
  }
  return undefined;
}
