import type { ErrorDetail } from './error.js';
import type { Plan } from './plan.js';

export interface SubtaskResult<T> {
  status: 'success' | 'partial' | 'failed';
  data: T;
  errors?: ErrorDetail[];
  metadata?: SubtaskResultMetadata;
  replanNeeded?: boolean;
}

export interface SubtaskResultMetadata {
  durationMs: number;
  llmTokensUsed?: number;
  toolsInvoked?: string[];
}

export interface AggregatedResult {
  plan: Plan;
  results: Map<string, SubtaskResult<unknown>>;
  aggregatedOutput: unknown;
  totalDurationMs: number;
  totalTokensUsed: number;
}
