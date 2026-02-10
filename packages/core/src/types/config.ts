import type { LLMAdapter } from './llm.js';
import type { HookMap } from './hooks.js';
import type { RiskLevel } from './tool.js';
import type { AgentDefinition } from './agent.js';

export interface PlannerConfig {
  llm: LLMAdapter;
  mode?: 'single-shot' | 'stepwise';
  promptOverrides?: Partial<PromptSections>;
}

export interface PromptSections {
  preamble: string;
  guidelines: string;
  outputFormat: string;
}

export interface LimitsConfig {
  maxTokensPerPlan?: number;
  maxTokensPerAgent?: number;
  planTimeout?: number;
  subtaskTimeout?: number;
}

export interface PermissionsConfig {
  autoApprove?: RiskLevel[];
  requireConfirmation?: RiskLevel[];
  onConfirmation?: (
    toolName: string,
    params: unknown,
    context: { riskLevel: RiskLevel },
  ) => Promise<boolean>;
}

export interface PlanStoreAdapter {
  save(task: import('./task.js').Task): Promise<void>;
  load(taskId: string): Promise<import('./task.js').Task | null>;
  update(taskId: string, changes: Partial<import('./task.js').Task>): Promise<void>;
  delete(taskId: string): Promise<void>;
  list(filter?: import('./task.js').TaskFilter): Promise<import('./task.js').Task[]>;
}

export interface OrchestratorConfig {
  planner: PlannerConfig;
  agents?: AgentDefinition[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: import('./tool.js').ToolDefinition<any, any>[];
  hooks?: HookMap;
  limits?: LimitsConfig;
  permissions?: PermissionsConfig;
  store?: PlanStoreAdapter;
  maxConcurrency?: number;
  maxPlanDepth?: number;
}
