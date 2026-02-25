import { z } from 'zod';
import { defineTool } from '../define-tool.js';

const TextExtractionParams = z.object({
  content: z.string(),
  format: z.enum(['html', 'json', 'plain']).default('plain'),
  selector: z.string().optional(),
});

export const textExtractionTool = defineTool({
  name: 'text-extraction',
  description: 'Extracts and structures text from various formats (HTML, JSON, plain text)',
  riskLevel: 'read-only',
  parameters: TextExtractionParams,
  execute: async (params) => {
    switch (params.format) {
      case 'html':
        return { text: stripHtml(params.content) };
      case 'json':
        return { text: extractFromJson(params.content, params.selector) };
      case 'plain':
      default:
        return { text: params.content.trim() };
    }
  },
});

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFromJson(content: string, selector?: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return `[JSON parse error: ${e instanceof Error ? e.message : String(e)}]`;
  }

  if (!selector) {
    return JSON.stringify(parsed, null, 2);
  }

  const keys = selector.split('.');
  let current: unknown = parsed;

  for (const key of keys) {
    if (current == null || typeof current !== 'object') {
      return '';
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'string' ? current : JSON.stringify(current, null, 2);
}
