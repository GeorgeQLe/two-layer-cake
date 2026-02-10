import { describe, it, expect, vi } from 'vitest';
import { textExtractionTool } from '../../src/tools/built-in/text-extraction.js';
import { createWebSearchTool } from '../../src/tools/built-in/web-search.js';
import type { ToolContext } from '../../src/types/index.js';

const ctx: ToolContext = {
  abortSignal: new AbortController().signal,
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
};

describe('textExtractionTool', () => {
  it('strips HTML tags and scripts', async () => {
    const html = '<script>alert("x")</script><p>Hello <b>world</b></p>';
    const result = await textExtractionTool.execute({ content: html, format: 'html' }, ctx);
    expect(result.text).not.toContain('<script>');
    expect(result.text).not.toContain('<p>');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('world');
  });

  it('strips style tags', async () => {
    const html = '<style>.x{color:red}</style><div>Content</div>';
    const result = await textExtractionTool.execute({ content: html, format: 'html' }, ctx);
    expect(result.text).not.toContain('color');
    expect(result.text).toContain('Content');
  });

  it('extracts from JSON without selector', async () => {
    const json = JSON.stringify({ key: 'value' });
    const result = await textExtractionTool.execute({ content: json, format: 'json' }, ctx);
    expect(result.text).toContain('"key"');
    expect(result.text).toContain('"value"');
  });

  it('extracts from JSON with dot-path selector', async () => {
    const json = JSON.stringify({ a: { b: 'deep' } });
    const result = await textExtractionTool.execute({ content: json, format: 'json', selector: 'a.b' }, ctx);
    expect(result.text).toBe('deep');
  });

  it('returns empty string for invalid selector path', async () => {
    const json = JSON.stringify({ a: 1 });
    const result = await textExtractionTool.execute({ content: json, format: 'json', selector: 'a.b.c' }, ctx);
    expect(result.text).toBe('');
  });

  it('trims plain text', async () => {
    const result = await textExtractionTool.execute({ content: '  hello  ', format: 'plain' }, ctx);
    expect(result.text).toBe('hello');
  });

  it('defaults to plain format', async () => {
    // The Zod schema has a default of 'plain', so calling without format should work
    const result = await textExtractionTool.execute({ content: ' trimmed ' } as any, ctx);
    expect(result.text).toBe('trimmed');
  });
});

describe('createWebSearchTool', () => {
  it('calls the adapter with query and maxResults', async () => {
    const mockAdapter = vi.fn().mockResolvedValue([
      { title: 'Result 1', url: 'https://example.com', snippet: 'snippet' },
    ]);

    const tool = createWebSearchTool({ adapter: mockAdapter });
    expect(tool.name).toBe('web-search');
    expect(tool.riskLevel).toBe('network');

    const result = await tool.execute({ query: 'test query', maxResults: 5 }, ctx);
    expect(mockAdapter).toHaveBeenCalledWith('test query', { maxResults: 5 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Result 1');
  });

  it('defaults maxResults to 10', async () => {
    const mockAdapter = vi.fn().mockResolvedValue([]);
    const tool = createWebSearchTool({ adapter: mockAdapter });

    await tool.execute({ query: 'test' }, ctx);
    expect(mockAdapter).toHaveBeenCalledWith('test', { maxResults: 10 });
  });
});
