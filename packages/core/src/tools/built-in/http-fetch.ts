import { z } from 'zod';
import { defineTool } from '../define-tool.js';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '0.0.0.0',
  'metadata.google.internal',
]);

const PRIVATE_IP_PATTERNS = [
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // Link-local + AWS IMDS
  /^0\./, // 0.0.0.0/8
];

function validateUrlSecurity(urlString: string): void {
  const parsed = new URL(urlString);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked protocol: ${parsed.protocol} — only http: and https: are allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Blocked hostname: ${hostname} — requests to local/metadata addresses are not allowed`,
    );
  }

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(
        `Blocked private IP: ${hostname} — requests to private networks are not allowed`,
      );
    }
  }

  // IPv6 loopback/private
  if (hostname.startsWith('[')) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    if (
      ipv6 === '::1' ||
      ipv6.startsWith('fe80:') ||
      ipv6.startsWith('fc') ||
      ipv6.startsWith('fd')
    ) {
      throw new Error(`Blocked private IPv6 address: ${hostname}`);
    }
  }
}

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
    validateUrlSecurity(params.url);

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
