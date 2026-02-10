import type { ZodSchema } from 'zod';
import type { ToolDefinition, RiskLevel, ToolContext } from '../types/index.js';

export interface DefineToolConfig<TParams, TResult> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  parameters: ZodSchema<TParams>;
  execute: (params: TParams, context: ToolContext) => Promise<TResult>;
}

export function defineTool<TParams, TResult>(
  config: DefineToolConfig<TParams, TResult>,
): ToolDefinition<TParams, TResult> {
  if (!config.name || typeof config.name !== 'string') {
    throw new Error('Tool name is required and must be a non-empty string');
  }

  if (!config.description || typeof config.description !== 'string') {
    throw new Error('Tool description is required and must be a non-empty string');
  }

  const validRiskLevels: RiskLevel[] = ['read-only', 'write', 'execute', 'network'];
  if (!validRiskLevels.includes(config.riskLevel)) {
    throw new Error(`Invalid risk level: ${config.riskLevel}`);
  }

  if (!config.parameters) {
    throw new Error('Tool parameters schema is required');
  }

  if (typeof config.execute !== 'function') {
    throw new Error('Tool execute function is required');
  }

  const tool: ToolDefinition<TParams, TResult> = {
    name: config.name,
    description: config.description,
    riskLevel: config.riskLevel,
    parameters: config.parameters,
    execute: config.execute,
  };

  return Object.freeze(tool);
}
