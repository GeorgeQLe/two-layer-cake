import type {
  LLMAdapter,
  Message,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
} from '../types/index.js';
import type { ZodType, ZodTypeDef } from 'zod';

export interface MockCall {
  method: 'complete' | 'stream' | 'completeStructured' | 'countTokens';
  messages: Message[];
  options?: CompletionOptions;
}

export class MockLLMAdapter implements LLMAdapter {
  readonly calls: MockCall[] = [];

  private completeHandlers: Array<(messages: Message[]) => CompletionResult> = [];
  private structuredHandlers: Array<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (messages: Message[], schema: ZodType<any, any, any>) => unknown
  > = [];
  private streamHandlers: Array<(messages: Message[]) => StreamChunk[]> = [];
  private completeIndex = 0;
  private structuredIndex = 0;
  private streamIndex = 0;

  onComplete(handler: (messages: Message[]) => CompletionResult): this {
    this.completeHandlers.push(handler);
    return this;
  }

  onCompleteStructured<T>(
    handler: (messages: Message[], schema: ZodType<T>) => T,
  ): this {
    this.structuredHandlers.push(handler as typeof this.structuredHandlers[number]);
    return this;
  }

  onStream(handler: (messages: Message[]) => StreamChunk[]): this {
    this.streamHandlers.push(handler);
    return this;
  }

  async complete(
    messages: Message[],
    options?: CompletionOptions,
  ): Promise<CompletionResult> {
    this.calls.push({ method: 'complete', messages, options });

    if (this.completeHandlers.length > 0) {
      const handler =
        this.completeHandlers[
          Math.min(this.completeIndex, this.completeHandlers.length - 1)
        ]!;
      this.completeIndex++;
      return handler(messages);
    }

    return {
      content: 'mock response',
      tokensUsed: { input: 10, output: 10 },
      finishReason: 'stop',
    };
  }

  async *stream(
    messages: Message[],
    options?: CompletionOptions,
  ): AsyncIterable<StreamChunk> {
    this.calls.push({ method: 'stream', messages, options });

    if (this.streamHandlers.length > 0) {
      const handler =
        this.streamHandlers[
          Math.min(this.streamIndex, this.streamHandlers.length - 1)
        ]!;
      this.streamIndex++;
      for (const chunk of handler(messages)) {
        yield chunk;
      }
      return;
    }

    yield { type: 'text', content: 'mock stream', tokensUsed: { input: 5, output: 5 } };
    yield { type: 'done', content: '' };
  }

  async completeStructured<TOutput, TDef extends ZodTypeDef = ZodTypeDef, TInput = TOutput>(
    messages: Message[],
    schema: ZodType<TOutput, TDef, TInput>,
    options?: CompletionOptions,
  ): Promise<TOutput> {
    this.calls.push({ method: 'completeStructured', messages, options });

    if (this.structuredHandlers.length > 0) {
      const handler =
        this.structuredHandlers[
          Math.min(this.structuredIndex, this.structuredHandlers.length - 1)
        ]!;
      this.structuredIndex++;
      return handler(messages, schema) as TOutput;
    }

    return {} as TOutput;
  }

  async countTokens(messages: Message[]): Promise<number> {
    this.calls.push({ method: 'countTokens', messages });
    return messages.reduce((sum, m) => sum + m.content.length, 0);
  }

  reset(): void {
    this.calls.length = 0;
    this.completeHandlers.length = 0;
    this.structuredHandlers.length = 0;
    this.streamHandlers.length = 0;
    this.completeIndex = 0;
    this.structuredIndex = 0;
    this.streamIndex = 0;
  }

  getCompleteCalls(): MockCall[] {
    return this.calls.filter((c) => c.method === 'complete');
  }

  getStructuredCalls(): MockCall[] {
    return this.calls.filter((c) => c.method === 'completeStructured');
  }
}
