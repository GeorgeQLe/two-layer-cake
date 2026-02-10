import type { Plan, Subtask } from './plan.js';
import type { SubtaskResult, AggregatedResult } from './result.js';
import type { ErrorDetail, ErrorStrategy } from './error.js';

export interface BeforePlanContext {
  objective: string;
  constraints?: string[];
}

export interface ErrorContext {
  plan: Plan;
  subtask?: Subtask;
  retryCount: number;
}

export interface HookMap {
  beforePlan?: (
    context: BeforePlanContext,
  ) => Promise<BeforePlanContext | null | void> | BeforePlanContext | null | void;

  afterPlan?: (plan: Plan) => Promise<Plan | null | void> | Plan | null | void;

  beforeAgentExecute?: (
    subtask: Subtask,
    plan: Plan,
  ) => Promise<Subtask | null | void> | Subtask | null | void;

  afterAgentExecute?: (
    subtask: Subtask,
    result: SubtaskResult<unknown>,
  ) =>
    | Promise<SubtaskResult<unknown> | null | void>
    | SubtaskResult<unknown>
    | null
    | void;

  onError?: (
    error: ErrorDetail,
    context: ErrorContext,
  ) => Promise<ErrorStrategy | null | void> | ErrorStrategy | null | void;

  onPlanComplete?: (
    plan: Plan,
    results: Map<string, SubtaskResult<unknown>>,
  ) => Promise<AggregatedResult | null | void> | AggregatedResult | null | void;
}
