import type { ZodType, ZodTypeDef } from 'zod';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  finishReason: 'stop' | 'length' | 'tool_use' | 'error';
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'error' | 'done';
  content: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
}

export interface LLMAdapter {
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;
  stream(messages: Message[], options?: CompletionOptions): AsyncIterable<StreamChunk>;
  completeStructured<TOutput, TDef extends ZodTypeDef = ZodTypeDef, TInput = TOutput>(
    messages: Message[],
    schema: ZodType<TOutput, TDef, TInput>,
    options?: CompletionOptions,
  ): Promise<TOutput>;
  countTokens(messages: Message[]): Promise<number>;
}
