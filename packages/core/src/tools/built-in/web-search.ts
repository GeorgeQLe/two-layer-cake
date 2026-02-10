import { z } from 'zod';
import { defineTool } from '../define-tool.js';

export interface WebSearchAdapter {
  (query: string, options: { maxResults: number }): Promise<WebSearchResult[]>;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const WebSearchParams = z.object({
  query: z.string().min(1),
  maxResults: z.number().positive().optional(),
});

export function createWebSearchTool(config: {
  adapter: WebSearchAdapter;
}) {
  return defineTool({
    name: 'web-search',
    description: 'Search the web for information using a configured search provider',
    riskLevel: 'network',
    parameters: WebSearchParams,
    execute: async (params) => {
      const results = await config.adapter(params.query, {
        maxResults: params.maxResults ?? 10,
      });
      return { results };
    },
  });
}
