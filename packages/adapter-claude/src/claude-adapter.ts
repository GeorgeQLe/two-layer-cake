import Anthropic from '@anthropic-ai/sdk';
import type { ZodType, ZodTypeDef } from 'zod';
import type {
  LLMAdapter,
  Message,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
} from 'two-layer-cake';
import { zodToJsonSchema } from './zod-to-json-schema.js';

export interface ClaudeAdapterConfig {
  model: string;
  apiKey?: string;
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 4096;

export class ClaudeAdapter implements LLMAdapter {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: ClaudeAdapterConfig) {
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }

  async complete(
    messages: Message[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    const { systemMessages, userMessages } = splitMessages(messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
      messages: userMessages,
      temperature: options?.temperature,
      stop_sequences: options?.stopSequences,
    });

    const textContent = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      content: textContent,
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      finishReason: mapStopReason(response.stop_reason),
    };
  }

  async *stream(
    messages: Message[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    const { systemMessages, userMessages } = splitMessages(messages);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
      messages: userMessages,
      temperature: options?.temperature,
      stop_sequences: options?.stopSequences,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield {
          type: 'text',
          content: event.delta.text,
        };
      }
    }

    const finalMessage = await stream.finalMessage();

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

    const jsonSchema = zodToJsonSchema(schema);

    const response = await this.client.messages.create({
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
    });

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUseBlock) {
      throw new Error('Claude did not return a tool_use block for structured output');
    }

    return schema.parse(toolUseBlock.input);
  }

  async countTokens(messages: Message[]): Promise<number> {
    const { systemMessages, userMessages } = splitMessages(messages);

    try {
      const result = await this.client.messages.countTokens({
        model: this.model,
        system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
        messages: userMessages,
      });
      return result.input_tokens;
    } catch {
      // Fall back to rough estimation: ~4 chars per token
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

function mapStopReason(
  reason: string | null,
): CompletionResult['finishReason'] {
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
