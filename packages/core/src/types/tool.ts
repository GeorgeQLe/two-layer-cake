import type { ZodSchema } from 'zod';

export type RiskLevel = 'read-only' | 'write' | 'execute' | 'network';

export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  parameters: ZodSchema<TParams>;
  execute: (params: TParams, context: ToolContext) => Promise<TResult>;
}

export interface ToolContext {
  abortSignal: AbortSignal;
  logger: Logger;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
