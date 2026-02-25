import { z } from 'zod';

export const OrchestratorConfigSchema = z.object({
  planner: z
    .object({
      llm: z.object({}).passthrough(),
      mode: z.enum(['single-shot', 'stepwise']).optional(),
    })
    .passthrough(),
  agents: z.array(z.object({}).passthrough()).optional(),
  tools: z.array(z.object({}).passthrough()).optional(),
  hooks: z.object({}).passthrough().optional(),
  limits: z
    .object({
      maxTokensPerPlan: z.number().int().positive().optional(),
      maxTokensPerAgent: z.number().int().positive().optional(),
      planTimeout: z.number().int().positive().optional(),
      subtaskTimeout: z.number().int().positive().optional(),
    })
    .optional(),
  permissions: z.object({}).passthrough().optional(),
  store: z.object({}).passthrough().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  maxPlanDepth: z.number().int().positive().optional(),
});
