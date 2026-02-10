import type { Subtask, AgentContext, SubtaskResult } from '../types/index.js';

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly capabilities: string[];
  readonly tools?: string[];

  abstract execute(subtask: Subtask, context: AgentContext): Promise<SubtaskResult<unknown>>;

  async onInit(): Promise<void> {
    // Override in subclass if needed
  }

  async onDestroy(): Promise<void> {
    // Override in subclass if needed
  }

  toDefinition(): {
    name: string;
    description: string;
    capabilities: string[];
    tools?: string[];
    execute: (subtask: Subtask, context: AgentContext) => Promise<SubtaskResult<unknown>>;
    onInit?: () => Promise<void>;
    onDestroy?: () => Promise<void>;
  } {
    return {
      name: this.name,
      description: this.description,
      capabilities: this.capabilities,
      tools: this.tools,
      execute: (subtask, context) => this.execute(subtask, context),
      onInit: () => this.onInit(),
      onDestroy: () => this.onDestroy(),
    };
  }
}
