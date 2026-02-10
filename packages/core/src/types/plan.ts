import type { ErrorDetail } from './error.js';
import type { SubtaskResult } from './result.js';

export type PlanStatus = 'PLANNING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type SubtaskStatus = 'PENDING' | 'BLOCKED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface Subtask {
  id: string;
  description: string;
  agentType: string;
  assignedAgentId?: string;
  dependsOn: string[];
  priority: 'high' | 'medium' | 'low';
  estimatedComplexity?: 'simple' | 'moderate' | 'complex';
  contextFromPrevious?: string;
  status: SubtaskStatus;
  result?: SubtaskResult<unknown>;
  error?: ErrorDetail;
}

export interface Plan {
  id: string;
  interpretation: string;
  subtasks: Subtask[];
  reasoning?: string;
  parentPlanId?: string;
  depth: number;
}
