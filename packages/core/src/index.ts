export const VERSION = '1.0.0';

// Types
export type {
  LLMAdapter,
  Message,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
  ErrorDetail,
  ErrorStrategy,
  ToolDefinition,
  ToolContext,
  RiskLevel,
  Logger,
  AgentDefinition,
  AgentContext,
  AgentCapability,
  ScopedToolAccess,
  Plan,
  PlanStatus,
  Subtask,
  SubtaskStatus,
  SubtaskResult,
  SubtaskResultMetadata,
  AggregatedResult,
  Task,
  TaskFilter,
  OrchestratorEvents,
  StructuredEvent,
  TraceContext,
  BudgetUsage,
  HookMap,
  BeforePlanContext,
  ErrorContext,
  OrchestratorConfig,
  PlannerConfig,
  PromptSections,
  LimitsConfig,
  PermissionsConfig,
  PlanStoreAdapter,
} from './types/index.js';

// Orchestrator
export { Orchestrator } from './orchestrator/index.js';

// Agent system
export { defineAgent } from './agents/index.js';
export { BaseAgent } from './agents/index.js';
export { AgentRegistry } from './agents/index.js';
export { researcherAgent, analyzerAgent, answerGeneratorAgent } from './agents/index.js';

// Tool system
export { defineTool } from './tools/index.js';
export { ToolRegistry } from './tools/index.js';
export { createWebSearchTool } from './tools/index.js';
export { httpFetchTool, textExtractionTool } from './tools/index.js';
export type { WebSearchAdapter, WebSearchResult } from './tools/index.js';

// Errors
export {
  SDKError,
  DAGCycleError,
  BudgetExceededError,
  SubtaskTimeoutError,
  ToolAccessDeniedError,
  ToolConfirmationDeniedError,
  PlanValidationError,
  LLMError,
} from './errors/index.js';

export { retry } from './errors/index.js';
export type { RetryOptions } from './errors/index.js';

// State
export { InMemoryPlanStore } from './state/index.js';

// Observability
export { EventBus } from './observability/index.js';

// Planner
export { PlanSchema, SubtaskSchema, validatePlanSchema } from './planner/index.js';
