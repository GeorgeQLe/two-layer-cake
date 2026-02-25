import type { ErrorDetail } from '../types/index.js';

export abstract class SDKError extends Error implements ErrorDetail {
  readonly code: string;
  readonly retryable: boolean;
  readonly source: ErrorDetail['source'];
  readonly original?: unknown;

  constructor(detail: ErrorDetail) {
    super(detail.message, detail.original != null ? { cause: detail.original } : undefined);
    this.name = this.constructor.name;
    this.code = detail.code;
    this.retryable = detail.retryable;
    this.source = detail.source;
    this.original = detail.original;
  }

  toErrorDetail(): ErrorDetail {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      source: this.source,
      original: this.original,
    };
  }
}

export class DAGCycleError extends SDKError {
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super({
      code: 'DAG_CYCLE',
      message: `Circular dependency detected: ${cycle.join(' -> ')}`,
      retryable: false,
      source: 'system',
    });
    this.cycle = cycle;
  }
}

export class BudgetExceededError extends SDKError {
  readonly used: number;
  readonly budget: number;

  constructor(used: number, budget: number) {
    super({
      code: 'BUDGET_EXCEEDED',
      message: `Token budget exceeded: used ${used} of ${budget}`,
      retryable: false,
      source: 'system',
    });
    this.used = used;
    this.budget = budget;
  }
}

export class SubtaskTimeoutError extends SDKError {
  readonly subtaskId: string;
  readonly timeoutMs: number;

  constructor(subtaskId: string, timeoutMs: number) {
    super({
      code: 'SUBTASK_TIMEOUT',
      message: `Subtask "${subtaskId}" timed out after ${timeoutMs}ms`,
      retryable: true,
      source: 'system',
    });
    this.subtaskId = subtaskId;
    this.timeoutMs = timeoutMs;
  }
}

export class ToolAccessDeniedError extends SDKError {
  readonly toolName: string;
  readonly agentName: string;

  constructor(toolName: string, agentName: string) {
    super({
      code: 'TOOL_ACCESS_DENIED',
      message: `Agent "${agentName}" does not have access to tool "${toolName}"`,
      retryable: false,
      source: 'system',
    });
    this.toolName = toolName;
    this.agentName = agentName;
  }
}

export class ToolConfirmationDeniedError extends SDKError {
  readonly toolName: string;

  constructor(toolName: string) {
    super({
      code: 'TOOL_CONFIRMATION_DENIED',
      message: `Confirmation denied for tool "${toolName}"`,
      retryable: false,
      source: 'system',
    });
    this.toolName = toolName;
  }
}

export class PlanValidationError extends SDKError {
  readonly details: string[];

  constructor(details: string[]) {
    super({
      code: 'PLAN_VALIDATION',
      message: `Plan validation failed: ${details.join('; ')}`,
      retryable: false,
      source: 'system',
    });
    this.details = details;
  }
}
