import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineTool } from '../../src/tools/define-tool.js';

const validConfig = () => ({
  name: 'my-tool',
  description: 'A test tool',
  riskLevel: 'read-only' as const,
  parameters: z.object({ input: z.string() }),
  execute: async (params: { input: string }) => params.input,
});

describe('defineTool', () => {
  it('throws when name is missing', () => {
    const cfg = { ...validConfig(), name: '' };
    expect(() => defineTool(cfg)).toThrow('Tool name is required');
  });

  it('throws when name is not a string', () => {
    const cfg = { ...validConfig(), name: 123 as unknown as string };
    expect(() => defineTool(cfg)).toThrow('Tool name is required');
  });

  it('throws when description is missing', () => {
    const cfg = { ...validConfig(), description: '' };
    expect(() => defineTool(cfg)).toThrow('Tool description is required');
  });

  it('throws when description is not a string', () => {
    const cfg = { ...validConfig(), description: null as unknown as string };
    expect(() => defineTool(cfg)).toThrow('Tool description is required');
  });

  it('throws when parameters is missing', () => {
    const cfg = { ...validConfig(), parameters: undefined as any };
    expect(() => defineTool(cfg)).toThrow('Tool parameters schema is required');
  });

  it('throws when execute is missing', () => {
    const cfg = { ...validConfig(), execute: undefined as any };
    expect(() => defineTool(cfg)).toThrow('Tool execute function is required');
  });

  it('throws when riskLevel is invalid', () => {
    const cfg = { ...validConfig(), riskLevel: 'dangerous' as any };
    expect(() => defineTool(cfg)).toThrow('Invalid risk level');
  });

  it('accepts all valid risk levels', () => {
    for (const level of ['read-only', 'write', 'execute', 'network'] as const) {
      const tool = defineTool({ ...validConfig(), riskLevel: level });
      expect(tool.riskLevel).toBe(level);
    }
  });

  it('returns a frozen object with all fields', () => {
    const tool = defineTool(validConfig());
    expect(tool.name).toBe('my-tool');
    expect(tool.description).toBe('A test tool');
    expect(tool.riskLevel).toBe('read-only');
    expect(typeof tool.execute).toBe('function');
    expect(Object.isFrozen(tool)).toBe(true);
  });
});
