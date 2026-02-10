import { describe, it, expect } from 'vitest';
import { defineAgent } from '../../src/agents/define-agent.js';

const validConfig = () => ({
  name: 'test-agent',
  description: 'A test agent',
  capabilities: ['research'],
  execute: async () => ({ status: 'success' as const, data: 'done', metadata: { durationMs: 0 } }),
});

describe('defineAgent', () => {
  it('throws when name is missing', () => {
    expect(() => defineAgent({ ...validConfig(), name: '' })).toThrow('Agent name is required');
  });

  it('throws when name is not a string', () => {
    expect(() => defineAgent({ ...validConfig(), name: 42 as any })).toThrow('Agent name is required');
  });

  it('throws when description is missing', () => {
    expect(() => defineAgent({ ...validConfig(), description: '' })).toThrow('Agent description is required');
  });

  it('throws when description is not a string', () => {
    expect(() => defineAgent({ ...validConfig(), description: null as any })).toThrow('Agent description is required');
  });

  it('throws when capabilities is empty', () => {
    expect(() => defineAgent({ ...validConfig(), capabilities: [] })).toThrow('at least one capability');
  });

  it('throws when capabilities is not an array', () => {
    expect(() => defineAgent({ ...validConfig(), capabilities: 'research' as any })).toThrow('at least one capability');
  });

  it('throws when execute is missing', () => {
    expect(() => defineAgent({ ...validConfig(), execute: undefined as any })).toThrow('execute function is required');
  });

  it('returns a frozen object with correct fields', () => {
    const agent = defineAgent(validConfig());
    expect(agent.name).toBe('test-agent');
    expect(agent.description).toBe('A test agent');
    expect(agent.capabilities).toEqual(['research']);
    expect(typeof agent.execute).toBe('function');
    expect(Object.isFrozen(agent)).toBe(true);
  });

  it('copies capabilities array to prevent mutation', () => {
    const caps = ['a', 'b'];
    const agent = defineAgent({ ...validConfig(), capabilities: caps });
    caps.push('c');
    expect(agent.capabilities).toEqual(['a', 'b']);
  });

  it('copies tools array to prevent mutation', () => {
    const tools = ['tool-a'];
    const agent = defineAgent({ ...validConfig(), tools });
    tools.push('tool-b');
    expect(agent.tools).toEqual(['tool-a']);
  });
});
