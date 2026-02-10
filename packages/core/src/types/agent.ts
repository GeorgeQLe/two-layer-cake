import type { LLMAdapter } from './llm.js';
import type { Logger } from './tool.js';
import type { Subtask } from './plan.js';
import type { SubtaskResult } from './result.js';
import type { Plan } from './plan.js';

export interface AgentCapability {
  name: string;
  description?: string;
}

export interface AgentContext {
  tools: ScopedToolAccess;
  llm: LLMAdapter;
  abortSignal: AbortSignal;
  logger: Logger;
  emitEvent: (type: string, data: unknown) => void;
  createSubPlan?: (objective: string) => Promise<Plan>;
}

export interface ScopedToolAccess {
  invoke<T = unknown>(toolName: string, params: unknown): Promise<T>;
  list(): string[];
  has(toolName: string): boolean;
}

export interface AgentDefinition {
  name: string;
  description: string;
  capabilities: string[];
  tools?: string[];
  llm?: LLMAdapter;
  execute: (subtask: Subtask, context: AgentContext) => Promise<SubtaskResult<unknown>>;
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
}
