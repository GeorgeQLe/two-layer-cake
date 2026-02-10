import { z } from 'zod';

export const SubtaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  agentType: z.string(),
  dependsOn: z.array(z.string()).default([]),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  estimatedComplexity: z.enum(['simple', 'moderate', 'complex']).optional(),
  contextFromPrevious: z.string().optional(),
});

export const PlanSchema = z.object({
  interpretation: z.string(),
  subtasks: z.array(SubtaskSchema),
  reasoning: z.string().optional(),
});

export type PlanSchemaOutput = z.output<typeof PlanSchema>;

export function validatePlanSchema(data: unknown): PlanSchemaOutput {
  return PlanSchema.parse(data);
}
