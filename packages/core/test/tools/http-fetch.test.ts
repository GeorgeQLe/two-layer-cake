import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpFetchTool } from '../../src/tools/built-in/http-fetch.js';

function makeContext(signal?: AbortSignal) {
  return {
    abortSignal: signal ?? new AbortController().signal,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe('httpFetchTool', () => {
  describe('SSRF protection (validateUrlSecurity)', () => {
    describe('blocked protocols', () => {
      it('rejects file:// protocol', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'file:///etc/passwd', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked protocol');
      });

      it('rejects ftp:// protocol', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'ftp://example.com/file', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked protocol');
      });
    });

    describe('blocked hostnames', () => {
      it('rejects localhost', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://localhost/api', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked hostname');
      });

      it('rejects 127.0.0.1', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://127.0.0.1/api', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked hostname');
      });

      it('rejects 0.0.0.0', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://0.0.0.0/api', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked hostname');
      });

      it('rejects metadata.google.internal', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://metadata.google.internal/', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked hostname');
      });
    });

    describe('blocked private IPs', () => {
      it('rejects 10.0.0.1 (RFC 1918)', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://10.0.0.1/', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked private IP');
      });

      it('rejects 172.16.0.1 (RFC 1918)', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://172.16.0.1/', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked private IP');
      });

      it('rejects 192.168.1.1 (RFC 1918)', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://192.168.1.1/', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked private IP');
      });

      it('rejects 169.254.169.254 (AWS IMDS)', async () => {
        await expect(
          httpFetchTool.execute(
            { url: 'http://169.254.169.254/', method: 'GET', timeout: 5000 },
            makeContext(),
          ),
        ).rejects.toThrow('Blocked private IP');
      });
    });

    describe('allowed URLs', () => {
      it('allows https://api.example.com (does not throw SSRF error)', async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(
            new Response('ok', {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'text/plain' },
            }),
          );
        vi.stubGlobal('fetch', mockFetch);

        const result = await httpFetchTool.execute(
          { url: 'https://api.example.com/data', method: 'GET', timeout: 5000 },
          makeContext(),
        );

        expect(result.status).toBe(200);
        vi.unstubAllGlobals();
      });

      it('allows public IP 8.8.8.8', async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(
            new Response('ok', {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'text/plain' },
            }),
          );
        vi.stubGlobal('fetch', mockFetch);

        const result = await httpFetchTool.execute(
          { url: 'http://8.8.8.8/', method: 'GET', timeout: 5000 },
          makeContext(),
        );

        expect(result.status).toBe(200);
        vi.unstubAllGlobals();
      });
    });
  });

  describe('execute() response handling', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('parses JSON response when content-type is application/json', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ key: 'value' }), {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        }),
      );

      const result = await httpFetchTool.execute(
        { url: 'https://api.example.com/data', method: 'GET', timeout: 5000 },
        makeContext(),
      );

      expect(result.status).toBe(200);
      expect(result.statusText).toBe('OK');
      expect(result.data).toEqual({ key: 'value' });
      expect(result.headers).toBeDefined();
    });

    it('returns text response when content-type is text/plain', async () => {
      mockFetch.mockResolvedValue(
        new Response('Hello, world!', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        }),
      );

      const result = await httpFetchTool.execute(
        { url: 'https://api.example.com/text', method: 'GET', timeout: 5000 },
        makeContext(),
      );

      expect(result.data).toBe('Hello, world!');
    });

    it('returns { status, statusText, headers, data } shape', async () => {
      mockFetch.mockResolvedValue(
        new Response('body', {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'text/plain', 'x-custom': 'value' },
        }),
      );

      const result = await httpFetchTool.execute(
        { url: 'https://api.example.com/create', method: 'POST', body: '{"a":1}', timeout: 5000 },
        makeContext(),
      );

      expect(result).toHaveProperty('status', 201);
      expect(result).toHaveProperty('statusText', 'Created');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('data');
    });

    it('passes configured method and body to fetch', async () => {
      mockFetch.mockResolvedValue(
        new Response('ok', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        }),
      );

      await httpFetchTool.execute(
        {
          url: 'https://api.example.com/post',
          method: 'POST',
          body: '{"data":"test"}',
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        },
        makeContext(),
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.example.com/post');
      expect(options.method).toBe('POST');
      expect(options.body).toBe('{"data":"test"}');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('forwards parent abort signal to fetch', async () => {
      const controller = new AbortController();
      controller.abort(); // pre-abort

      mockFetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      await expect(
        httpFetchTool.execute(
          { url: 'https://api.example.com/', method: 'GET', timeout: 5000 },
          makeContext(controller.signal),
        ),
      ).rejects.toThrow();
    });

    it('cleans up abort listener after completion', async () => {
      const controller = new AbortController();
      const removeListenerSpy = vi.spyOn(controller.signal, 'removeEventListener');

      mockFetch.mockResolvedValue(
        new Response('ok', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        }),
      );

      await httpFetchTool.execute(
        { url: 'https://api.example.com/', method: 'GET', timeout: 5000 },
        makeContext(controller.signal),
      );

      expect(removeListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('does not call fetch for blocked URLs', async () => {
      await expect(
        httpFetchTool.execute(
          { url: 'http://10.0.0.1/', method: 'GET', timeout: 5000 },
          makeContext(),
        ),
      ).rejects.toThrow('Blocked private IP');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
