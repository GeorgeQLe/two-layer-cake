import type { AgentDefinition } from '../types/index.js';
import { BaseAgent } from './base-agent.js';

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition | BaseAgent): void {
    const definition = agent instanceof BaseAgent ? agent.toDefinition() : agent;

    if (this.agents.has(definition.name)) {
      throw new Error(`Agent "${definition.name}" is already registered`);
    }

    this.agents.set(definition.name, definition);
  }

  resolve(agentType: string): AgentDefinition | undefined {
    return this.agents.get(agentType);
  }

  has(agentType: string): boolean {
    return this.agents.has(agentType);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  listCapabilities(): Array<{
    name: string;
    description: string;
    capabilities: string[];
  }> {
    return this.list().map((a) => ({
      name: a.name,
      description: a.description,
      capabilities: a.capabilities,
    }));
  }

  names(): string[] {
    return Array.from(this.agents.keys());
  }
}
