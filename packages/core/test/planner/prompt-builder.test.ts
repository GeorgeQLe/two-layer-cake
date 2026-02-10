import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../src/planner/prompt-builder.js';
import { AgentRegistry } from '../../src/agents/agent-registry.js';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { defineAgent } from '../../src/agents/define-agent.js';
import { defineTool } from '../../src/tools/define-tool.js';
import { z } from 'zod';

function makeRegistries() {
  const agents = new AgentRegistry();
  agents.register(
    defineAgent({
      name: 'researcher',
      description: 'Researches topics',
      capabilities: ['research'],
      execute: async () => ({ status: 'success' as const, data: null, metadata: { durationMs: 0 } }),
    }),
  );

  const tools = new ToolRegistry();
  tools.register(
    defineTool({
      name: 'web-search',
      description: 'Search the web',
      riskLevel: 'network',
      parameters: z.object({}),
      execute: async () => null,
    }),
  );

  return { agents, tools };
}

describe('PromptBuilder', () => {
  it('buildPlanPrompt includes agent descriptions', () => {
    const { agents, tools } = makeRegistries();
    const builder = new PromptBuilder(agents, tools);
    const messages = builder.buildPlanPrompt('Find info about cats');

    const system = messages[0]!.content;
    expect(system).toContain('researcher');
    expect(system).toContain('Researches topics');
    expect(system).toContain('research');
  });

  it('buildPlanPrompt includes tool descriptions', () => {
    const { agents, tools } = makeRegistries();
    const builder = new PromptBuilder(agents, tools);
    const messages = builder.buildPlanPrompt('Find info');

    const system = messages[0]!.content;
    expect(system).toContain('web-search');
    expect(system).toContain('Search the web');
    expect(system).toContain('[network]');
  });

  it('buildPlanPrompt sends objective as user message', () => {
    const { agents, tools } = makeRegistries();
    const builder = new PromptBuilder(agents, tools);
    const messages = builder.buildPlanPrompt('My objective');

    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toBe('My objective');
  });

  it('shows "none" when registries are empty', () => {
    const builder = new PromptBuilder(new AgentRegistry(), new ToolRegistry());
    const messages = builder.buildPlanPrompt('test');
    const system = messages[0]!.content;
    expect(system).toContain('Available agents: none');
    expect(system).toContain('Available tools: none');
  });

  it('uses prompt overrides when provided', () => {
    const { agents, tools } = makeRegistries();
    const builder = new PromptBuilder(agents, tools, {
      preamble: 'CUSTOM PREAMBLE',
      guidelines: 'CUSTOM GUIDELINES',
    });
    const messages = builder.buildPlanPrompt('test');
    const system = messages[0]!.content;
    expect(system).toContain('CUSTOM PREAMBLE');
    expect(system).toContain('CUSTOM GUIDELINES');
  });

  it('buildReplanPrompt includes trigger and plan summary', () => {
    const { agents, tools } = makeRegistries();
    const builder = new PromptBuilder(agents, tools);
    const messages = builder.buildReplanPrompt('objective', 'summary of plan', 'completed results', 'error occurred');

    const system = messages[0]!.content;
    expect(system).toContain('re-planning');
    expect(system).toContain('error occurred');

    const user = messages[1]!.content;
    expect(user).toContain('objective');
    expect(user).toContain('summary of plan');
    expect(user).toContain('completed results');
  });
});
