import type { Plan, Subtask } from './plan.js';
import type { SubtaskResult, AggregatedResult } from './result.js';
import type { ErrorDetail } from './error.js';

export interface BudgetUsage {
  used: number;
  total: number;
  percentage: number;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface StructuredEvent {
  timestamp: Date;
  type: string;
  planId: string;
  subtaskId?: string;
  agentId?: string;
  data: unknown;
  traceContext?: TraceContext;
}

export interface OrchestratorEvents {
  'plan:created': (plan: Plan) => void;
  'plan:executing': (plan: Plan) => void;
  'plan:completed': (plan: Plan, result: AggregatedResult) => void;
  'plan:failed': (plan: Plan, error: ErrorDetail) => void;
  'plan:cancelled': (plan: Plan) => void;

  'subtask:started': (subtask: Subtask) => void;
  'subtask:completed': (subtask: Subtask, result: SubtaskResult<unknown>) => void;
  'subtask:failed': (subtask: Subtask, error: ErrorDetail) => void;
  'subtask:skipped': (subtask: Subtask, reason: string) => void;

  'agent:started': (agentId: string, subtaskId: string) => void;
  'agent:progress': (agentId: string, progress: unknown) => void;
  'agent:completed': (agentId: string, subtaskId: string) => void;

  'replan:triggered': (reason: string, plan: Plan) => void;
  'budget:warning': (usage: BudgetUsage) => void;
  'budget:exceeded': (usage: BudgetUsage) => void;
}
