import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/tool-registry.js';
import { ScopedToolRegistry } from '../../src/tools/scoped-tool-registry.js';
import { defineTool } from '../../src/tools/define-tool.js';
import { ToolAccessDeniedError, ToolConfirmationDeniedError } from '../../src/errors/sdk-errors.js';
import type { ToolContext, PermissionsConfig } from '../../src/types/index.js';

const dummyContext: ToolContext = {
  abortSignal: new AbortController().signal,
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
};

function setup(opts?: { allowed?: string[]; permissions?: PermissionsConfig }) {
  const registry = new ToolRegistry();

  const echoTool = defineTool({
    name: 'echo',
    description: 'echoes input',
    riskLevel: 'read-only',
    parameters: z.object({ msg: z.string() }),
    execute: async (p) => p.msg,
  });

  const writeTool = defineTool({
    name: 'write-file',
    description: 'writes a file',
    riskLevel: 'write',
    parameters: z.object({ path: z.string(), content: z.string() }),
    execute: async (p) => `wrote ${p.path}`,
  });

  registry.register(echoTool);
  registry.register(writeTool);

  const permissions: PermissionsConfig = opts?.permissions ?? { autoApprove: ['read-only', 'write'] };
  const allowed = opts?.allowed ?? ['echo', 'write-file'];

  return new ScopedToolRegistry(registry, allowed, 'test-agent', permissions, dummyContext);
}

describe('ScopedToolRegistry', () => {
  it('invoke allowed tool returns result', async () => {
    const scoped = setup();
    const result = await scoped.invoke<string>('echo', { msg: 'hello' });
    expect(result).toBe('hello');
  });

  it('invoke denied tool throws ToolAccessDeniedError', async () => {
    const scoped = setup({ allowed: ['echo'] });
    await expect(scoped.invoke('write-file', { path: 'a', content: 'b' }))
      .rejects.toThrow(ToolAccessDeniedError);
  });

  it('Zod validation rejects bad params', async () => {
    const scoped = setup();
    await expect(scoped.invoke('echo', { msg: 123 })).rejects.toThrow();
  });

  it('Zod validation passes good params', async () => {
    const scoped = setup();
    await expect(scoped.invoke('echo', { msg: 'ok' })).resolves.toBe('ok');
  });

  it('requireConfirmation approved allows execution', async () => {
    const onConfirmation = vi.fn().mockResolvedValue(true);
    const scoped = setup({
      permissions: {
        requireConfirmation: ['write'],
        onConfirmation,
      },
    });
    const result = await scoped.invoke<string>('write-file', { path: 'f', content: 'c' });
    expect(result).toBe('wrote f');
    expect(onConfirmation).toHaveBeenCalledOnce();
  });

  it('requireConfirmation denied throws ToolConfirmationDeniedError', async () => {
    const onConfirmation = vi.fn().mockResolvedValue(false);
    const scoped = setup({
      permissions: {
        requireConfirmation: ['write'],
        onConfirmation,
      },
    });
    await expect(scoped.invoke('write-file', { path: 'f', content: 'c' }))
      .rejects.toThrow(ToolConfirmationDeniedError);
  });

  it('list returns only allowed tools that exist in registry', () => {
    const scoped = setup({ allowed: ['echo', 'nonexistent'] });
    expect(scoped.list()).toEqual(['echo']);
  });

  it('has returns correct results', () => {
    const scoped = setup({ allowed: ['echo'] });
    expect(scoped.has('echo')).toBe(true);
    expect(scoped.has('write-file')).toBe(false);
  });
});
