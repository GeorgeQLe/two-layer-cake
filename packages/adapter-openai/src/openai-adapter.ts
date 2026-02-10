import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ZodType, ZodTypeDef } from 'zod';
import type {
  LLMAdapter,
  Message,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
} from 'two-layer-cake';

export interface OpenAIAdapterConfig {
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 4096;

export class OpenAIAdapter implements LLMAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: OpenAIAdapterConfig) {
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.client = new OpenAI({
      apiKey: config.apiKey,
    });
  }

  async complete(
    messages: Message[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      messages: toOpenAIMessages(messages),
      temperature: options?.temperature,
      stop: options?.stopSequences,
    });

    const choice = response.choices[0];

    return {
      content: choice?.message?.content ?? '',
      tokensUsed: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
      finishReason: mapFinishReason(choice?.finish_reason),
    };
  }

  async *stream(
    messages: Message[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      messages: toOpenAIMessages(messages),
      temperature: options?.temperature,
      stop: options?.stopSequences,
      stream: true,
      stream_options: { include_usage: true },
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
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
    const response = await this.client.beta.chat.completions.parse({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      messages: toOpenAIMessages(messages),
      temperature: options?.temperature,
      stop: options?.stopSequences,
      response_format: zodResponseFormat(schema as ZodType, 'structured_output'),
    });

    const choice = response.choices[0];
    const parsed = choice?.message?.parsed;

    if (parsed === null || parsed === undefined) {
      // If parsed is not available, try to parse the raw content
      const raw = choice?.message?.content;
      if (!raw) {
        throw new Error('OpenAI did not return structured output');
      }
      return schema.parse(JSON.parse(raw));
    }

    return parsed as TOutput;
  }

  async countTokens(messages: Message[]): Promise<number> {
    // Rough estimation: ~4 characters per token on average
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    // Add overhead for role markers and message formatting (~4 tokens per message)
    const overheadTokens = messages.length * 4;
    return Math.ceil(totalChars / 4) + overheadTokens;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

function toOpenAIMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((msg): OpenAIMessage => ({
    role: msg.role,
    content: msg.content,
  }));
}

function mapFinishReason(
  reason: string | null | undefined,
): CompletionResult['finishReason'] {
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
