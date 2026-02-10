import type { AgentDefinition, LLMAdapter } from '../types/index.js';

export interface DefineAgentConfig {
  name: string;
  description: string;
  capabilities: string[];
  tools?: string[];
  llm?: LLMAdapter;
  execute: AgentDefinition['execute'];
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
}

export function defineAgent(config: DefineAgentConfig): AgentDefinition {
  if (!config.name || typeof config.name !== 'string') {
    throw new Error('Agent name is required and must be a non-empty string');
  }

  if (!config.description || typeof config.description !== 'string') {
    throw new Error('Agent description is required and must be a non-empty string');
  }

  if (!Array.isArray(config.capabilities) || config.capabilities.length === 0) {
    throw new Error('Agent must have at least one capability');
  }

  if (typeof config.execute !== 'function') {
    throw new Error('Agent execute function is required');
  }

  const agent: AgentDefinition = {
    name: config.name,
    description: config.description,
    capabilities: [...config.capabilities],
    tools: config.tools ? [...config.tools] : undefined,
    llm: config.llm,
    execute: config.execute,
    onInit: config.onInit,
    onDestroy: config.onDestroy,
  };

  return Object.freeze(agent);
}
