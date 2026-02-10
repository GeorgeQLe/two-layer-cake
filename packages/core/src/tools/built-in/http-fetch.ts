import { z } from 'zod';
import { defineTool } from '../define-tool.js';

const HttpFetchParams = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  timeout: z.number().positive().optional().default(30000),
});

export const httpFetchTool = defineTool({
  name: 'http-fetch',
  description: 'Makes HTTP requests and returns response data',
  riskLevel: 'network',
  parameters: HttpFetchParams,
  execute: async (params, context) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeout);

    // Link parent abort signal
    const onParentAbort = () => controller.abort();
    context.abortSignal.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await fetch(params.url, {
        method: params.method,
        headers: params.headers,
        body: params.body,
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') ?? '';
      let data: unknown;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      };
    } finally {
      clearTimeout(timeout);
      context.abortSignal.removeEventListener('abort', onParentAbort);
    }
  },
});
