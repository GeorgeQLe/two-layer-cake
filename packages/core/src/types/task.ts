import type { Plan, PlanStatus } from './plan.js';

export interface Task {
  id: string;
  objective: string;
  plan: Plan;
  status: PlanStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskFilter {
  status?: PlanStatus;
  createdAfter?: Date;
  createdBefore?: Date;
}
