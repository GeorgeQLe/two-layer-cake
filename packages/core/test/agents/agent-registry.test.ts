import { describe, it, expect } from 'vitest';
import { AgentRegistry } from '../../src/agents/agent-registry.js';
import { BaseAgent } from '../../src/agents/base-agent.js';
import { defineAgent } from '../../src/agents/define-agent.js';
import type { Subtask, AgentContext, SubtaskResult } from '../../src/types/index.js';

function makeAgent(name: string) {
  return defineAgent({
    name,
    description: `${name} agent`,
    capabilities: ['cap-' + name],
    execute: async () => ({ status: 'success' as const, data: null, metadata: { durationMs: 0 } }),
  });
}

class TestBaseAgent extends BaseAgent {
  readonly name = 'base-test';
  readonly description = 'A base agent';
  readonly capabilities = ['base-cap'];

  async execute(subtask: Subtask, context: AgentContext): Promise<SubtaskResult<unknown>> {
    return { status: 'success', data: 'base-result', metadata: { durationMs: 0 } };
  }
}

describe('AgentRegistry', () => {
  it('register and resolve an agent', () => {
    const reg = new AgentRegistry();
    const agent = makeAgent('alpha');
    reg.register(agent);
    expect(reg.resolve('alpha')).toBe(agent);
  });

  it('has returns true for registered agent', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent('a'));
    expect(reg.has('a')).toBe(true);
    expect(reg.has('b')).toBe(false);
  });

  it('list returns all agents', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent('x'));
    reg.register(makeAgent('y'));
    expect(reg.list()).toHaveLength(2);
  });

  it('names returns all agent names', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent('one'));
    reg.register(makeAgent('two'));
    expect(reg.names()).toEqual(['one', 'two']);
  });

  it('listCapabilities returns name/description/capabilities', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent('r'));
    const caps = reg.listCapabilities();
    expect(caps).toEqual([
      { name: 'r', description: 'r agent', capabilities: ['cap-r'] },
    ]);
  });

  it('throws on duplicate agent name', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent('dup'));
    expect(() => reg.register(makeAgent('dup'))).toThrow('already registered');
  });

  it('resolve returns undefined for unknown agent', () => {
    const reg = new AgentRegistry();
    expect(reg.resolve('ghost')).toBeUndefined();
  });

  it('registers a BaseAgent via toDefinition', () => {
    const reg = new AgentRegistry();
    const baseAgent = new TestBaseAgent();
    reg.register(baseAgent);
    expect(reg.has('base-test')).toBe(true);
    const def = reg.resolve('base-test');
    expect(def).toBeDefined();
    expect(def!.capabilities).toEqual(['base-cap']);
  });
});
