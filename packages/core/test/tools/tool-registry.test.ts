import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { defineTool } from '../../src/tools/define-tool.js';

function makeTool(name: string, desc = 'A tool') {
  return defineTool({
    name,
    description: desc,
    riskLevel: 'read-only',
    parameters: z.object({}),
    execute: async () => null,
  });
}

describe('ToolRegistry', () => {
  it('register and get a tool', () => {
    const reg = new ToolRegistry();
    const tool = makeTool('alpha');
    reg.register(tool);
    expect(reg.get('alpha')).toBe(tool);
  });

  it('has returns true for registered tool', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('alpha'));
    expect(reg.has('alpha')).toBe(true);
    expect(reg.has('beta')).toBe(false);
  });

  it('list returns all registered tools', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a'));
    reg.register(makeTool('b'));
    expect(reg.list()).toHaveLength(2);
  });

  it('names returns all registered names', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('x'));
    reg.register(makeTool('y'));
    expect(reg.names()).toEqual(['x', 'y']);
  });

  it('descriptions returns name/description/riskLevel summaries', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('t1', 'Desc one'));
    const descs = reg.descriptions();
    expect(descs).toEqual([{ name: 't1', description: 'Desc one', riskLevel: 'read-only' }]);
  });

  it('throws on duplicate name', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('dup'));
    expect(() => reg.register(makeTool('dup'))).toThrow('already registered');
  });

  it('get returns undefined for unknown tool', () => {
    const reg = new ToolRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });
});
