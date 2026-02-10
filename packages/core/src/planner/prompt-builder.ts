import type { PromptSections, Message } from '../types/index.js';
import type { AgentRegistry } from '../agents/agent-registry.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import {
  DEFAULT_PREAMBLE,
  DEFAULT_GUIDELINES,
  DEFAULT_OUTPUT_FORMAT,
} from './prompt-sections.js';

export class PromptBuilder {
  private sections: PromptSections;

  constructor(
    private readonly agentRegistry: AgentRegistry,
    private readonly toolRegistry: ToolRegistry,
    overrides?: Partial<PromptSections>,
  ) {
    this.sections = {
      preamble: overrides?.preamble ?? DEFAULT_PREAMBLE,
      guidelines: overrides?.guidelines ?? DEFAULT_GUIDELINES,
      outputFormat: overrides?.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
    };
  }

  buildPlanPrompt(objective: string): Message[] {
    const agentSection = this.buildAgentSection();
    const toolSection = this.buildToolSection();

    const systemPrompt = [
      this.sections.preamble,
      '',
      agentSection,
      '',
      toolSection,
      '',
      this.sections.guidelines,
      '',
      this.sections.outputFormat,
    ].join('\n');

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: objective },
    ];
  }

  buildReplanPrompt(
    objective: string,
    currentPlanSummary: string,
    completedResults: string,
    trigger: string,
  ): Message[] {
    const agentSection = this.buildAgentSection();

    const systemPrompt = [
      this.sections.preamble,
      '',
      agentSection,
      '',
      'You are re-planning an existing objective due to new information.',
      `Re-plan trigger: ${trigger}`,
      '',
      this.sections.guidelines,
      '',
      this.sections.outputFormat,
    ].join('\n');

    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `Original objective: ${objective}`,
          '',
          `Current plan state:\n${currentPlanSummary}`,
          '',
          `Completed results:\n${completedResults}`,
          '',
          'Please produce an updated plan for the remaining work.',
        ].join('\n'),
      },
    ];
  }

  private buildAgentSection(): string {
    const agents = this.agentRegistry.listCapabilities();
    if (agents.length === 0) {
      return 'Available agents: none';
    }

    const lines = ['Available agents:'];
    for (const agent of agents) {
      lines.push(
        `- ${agent.name}: ${agent.description} (capabilities: ${agent.capabilities.join(', ')})`,
      );
    }
    return lines.join('\n');
  }

  private buildToolSection(): string {
    const tools = this.toolRegistry.descriptions();
    if (tools.length === 0) {
      return 'Available tools: none';
    }

    const lines = ['Available tools:'];
    for (const tool of tools) {
      lines.push(`- ${tool.name}: ${tool.description} [${tool.riskLevel}]`);
    }
    return lines.join('\n');
  }
}
