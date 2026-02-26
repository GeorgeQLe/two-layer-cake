import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
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
import { classifyError, isRetryable } from './classify-error.js';
import { createRequestSignal } from './create-signal.js';

export interface OpenAIAdapterConfig {
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

export class OpenAIAdapter implements LLMAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly logger: Logger;
  private readonly timeout: number;
  private readonly retryConfig: {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };

  constructor(config: OpenAIAdapterConfig) {
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.logger = config.logger ?? noopLogger;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: config.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY,
      maxDelayMs: config.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY,
    };
    this.client = new OpenAI({
      apiKey: config.apiKey,
      maxRetries: 0, // Disable SDK built-in retry; we manage retries ourselves
    });
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const signal = createRequestSignal(options?.signal, this.timeout);

    this.logger.debug('OpenAIAdapter.complete() called', { model: this.model });

    try {
      return await retry(
        async () => {
          const response = await this.client.chat.completions.create(
            {
              model: this.model,
              max_tokens: options?.maxTokens ?? this.maxTokens,
              messages: toOpenAIMessages(messages),
              temperature: options?.temperature,
              stop: options?.stopSequences,
            },
            { signal },
          );

          const choice = response.choices[0];

          this.logger.debug('OpenAIAdapter.complete() succeeded', {
            inputTokens: response.usage?.prompt_tokens,
            outputTokens: response.usage?.completion_tokens,
          });

          return {
            content: choice?.message?.content ?? '',
            tokensUsed: {
              input: response.usage?.prompt_tokens ?? 0,
              output: response.usage?.completion_tokens ?? 0,
            },
            finishReason: mapFinishReason(choice?.finish_reason),
          };
        },
        {
          maxRetries: this.retryConfig.maxRetries,
          baseDelayMs: this.retryConfig.baseDelayMs,
          maxDelayMs: this.retryConfig.maxDelayMs,
          signal: options?.signal,
          shouldRetry: isRetryable,
          onRetry: (_error, attempt) => {
            this.logger.warn(`OpenAIAdapter.complete() retry attempt ${attempt}`);
          },
        },
      );
    } catch (error) {
      const detail = classifyError(error);
      this.logger.warn('OpenAIAdapter.complete() error', {
        code: detail.code,
        retryable: detail.retryable,
      });
      throw new LLMError({ ...detail, provider: 'openai', httpStatus: getHttpStatus(error) });
    }
  }

  async *stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk> {
    const signal = createRequestSignal(options?.signal, this.timeout);

    this.logger.debug('OpenAIAdapter.stream() called', { model: this.model });

    // Retry only the connection establishment, not mid-stream
    let stream: Awaited<ReturnType<typeof this.client.chat.completions.create>>;
    try {
      stream = await retry(
        async () => {
          return await this.client.chat.completions.create(
            {
              model: this.model,
              max_tokens: options?.maxTokens ?? this.maxTokens,
              messages: toOpenAIMessages(messages),
              temperature: options?.temperature,
              stop: options?.stopSequences,
              stream: true,
              stream_options: { include_usage: true },
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
            this.logger.warn(`OpenAIAdapter.stream() retry attempt ${attempt}`);
          },
        },
      );
    } catch (error) {
      const detail = classifyError(error);
      this.logger.warn('OpenAIAdapter.stream() connection error', {
        code: detail.code,
        retryable: detail.retryable,
      });
      throw new LLMError({ ...detail, provider: 'openai', httpStatus: getHttpStatus(error) });
    }

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield {
          type: 'text',
          content: delta.content,
        };
      }

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    this.logger.debug('OpenAIAdapter.stream() completed', {
      inputTokens,
      outputTokens,
    });

    yield {
      type: 'done',
      content: '',
      tokensUsed: {
        input: inputTokens,
        output: outputTokens,
      },
    };
  }

  async completeStructured<TOutput, TDef extends ZodTypeDef = ZodTypeDef, TInput = TOutput>(
    messages: Message[],
    schema: ZodType<TOutput, TDef, TInput>,
    options?: CompletionOptions,
  ): Promise<TOutput> {
    const signal = createRequestSignal(options?.signal, this.timeout);

    this.logger.debug('OpenAIAdapter.completeStructured() called', { model: this.model });

    try {
      return await retry(
        async () => {
          const response = await this.client.beta.chat.completions.parse(
            {
              model: this.model,
              max_tokens: options?.maxTokens ?? this.maxTokens,
              messages: toOpenAIMessages(messages),
              temperature: options?.temperature,
              stop: options?.stopSequences,
              response_format: zodResponseFormat(schema as ZodType, 'structured_output'),
            },
            { signal },
          );

          const choice = response.choices[0];
          const parsed = choice?.message?.parsed;

          if (parsed === null || parsed === undefined) {
            const raw = choice?.message?.content;
            if (!raw) {
              throw new Error('OpenAI did not return structured output');
            }
            return schema.parse(JSON.parse(raw));
          }

          this.logger.debug('OpenAIAdapter.completeStructured() succeeded');
          return parsed as TOutput;
        },
        {
          maxRetries: this.retryConfig.maxRetries,
          baseDelayMs: this.retryConfig.baseDelayMs,
          maxDelayMs: this.retryConfig.maxDelayMs,
          signal: options?.signal,
          shouldRetry: isRetryable,
          onRetry: (_error, attempt) => {
            this.logger.warn(`OpenAIAdapter.completeStructured() retry attempt ${attempt}`);
          },
        },
      );
    } catch (error) {
      if (error instanceof LLMError) throw error;
      // Non-API errors (e.g., missing structured output, Zod/JSON parse) pass through
      const detail = classifyError(error);
      if (detail.code === 'LLM_UNKNOWN' && !(error instanceof OpenAI.APIError)) throw error;
      this.logger.warn('OpenAIAdapter.completeStructured() error', {
        code: detail.code,
        retryable: detail.retryable,
      });
      throw new LLMError({ ...detail, provider: 'openai', httpStatus: getHttpStatus(error) });
    }
  }

  async countTokens(messages: Message[]): Promise<number> {
    this.logger.debug('OpenAIAdapter.countTokens() called');

    let totalTokens = 3; // reply priming overhead
    for (const msg of messages) {
      totalTokens += 4; // per-message overhead
      totalTokens += 1; // role token
      totalTokens += Math.ceil(msg.content.length / 3.5);
    }
    return totalTokens;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map(
    (msg): OpenAIMessage => ({
      role: msg.role,
      content: msg.content,
    }),
  );
}

function mapFinishReason(reason: string | null | undefined): CompletionResult['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    default:
      return 'error';
  }
}

function getHttpStatus(error: unknown): number | undefined {
  if (error instanceof OpenAI.APIError) {
    return error.status;
  }
  return undefined;
}
