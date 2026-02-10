import type { LLMAdapter, Message, CompletionOptions, CompletionResult, StreamChunk } from '../../src/types/index.js';
import type { ZodType, ZodTypeDef } from 'zod';

export class MockLLMAdapter implements LLMAdapter {
  calls: Array<{ method: string; messages: Message[] }> = [];
  completeHandler: (messages: Message[]) => CompletionResult = () => ({
    content: 'mock response',
    tokensUsed: { input: 10, output: 10 },
    finishReason: 'stop',
  });
  structuredHandler: (messages: Message[], schema: any) => any = () => ({});

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', messages });
    return this.completeHandler(messages);
  }

  async *stream(messages: Message[]): AsyncIterable<StreamChunk> {
    this.calls.push({ method: 'stream', messages });
    yield { type: 'text', content: 'mock', tokensUsed: { input: 5, output: 5 } };
    yield { type: 'done', content: '' };
  }

  async completeStructured<TOutput, TDef extends ZodTypeDef = ZodTypeDef, TInput = TOutput>(
    messages: Message[],
    schema: ZodType<TOutput, TDef, TInput>,
  ): Promise<TOutput> {
    this.calls.push({ method: 'completeStructured', messages });
    return this.structuredHandler(messages, schema) as TOutput;
  }

  async countTokens(messages: Message[]): Promise<number> {
    return messages.reduce((acc, m) => acc + m.content.length, 0);
  }
}
