import { describe, it, expect, vi } from 'vitest';
import { retry } from '../../src/errors/retry.js';

describe('retry', () => {
  it('succeeds on first try without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('success');

    const result = await retry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff delays', async () => {
    vi.useFakeTimers();

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('done');

    const promise = retry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10000 });

    // First retry delay: 100 * 2^0 = 100ms
    await vi.advanceTimersByTimeAsync(100);
    // Second retry delay: 100 * 2^1 = 200ms
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('throws last error when max retries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

    await expect(
      retry(fn, { maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow('persistent failure');

    // attempt 0 + retry 1 + retry 2 = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately when abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = vi.fn().mockResolvedValue('ok');

    await expect(
      retry(fn, { maxRetries: 3, signal: controller.signal }),
    ).rejects.toThrow('Retry aborted');

    expect(fn).not.toHaveBeenCalled();
  });

  it('aborts during sleep when signal fires', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = retry(fn, {
      maxRetries: 5,
      baseDelayMs: 60000,
      signal: controller.signal,
    });

    // Allow the first attempt to fail and enter sleep
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();

    await expect(promise).rejects.toThrow('Retry aborted');
  });

  it('calls onRetry callback with error and attempt number', async () => {
    const onRetry = vi.fn();
    const error1 = new Error('e1');
    const error2 = new Error('e2');

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2)
      .mockResolvedValue('ok');

    await retry(fn, { maxRetries: 3, baseDelayMs: 1, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, error1, 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, error2, 2);
  });

  it('caps delay at maxDelayMs', async () => {
    vi.useFakeTimers();

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    // baseDelayMs=10000, maxDelayMs=500 => delay should be capped at 500
    const promise = retry(fn, { maxRetries: 1, baseDelayMs: 10000, maxDelayMs: 500 });

    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe('ok');

    vi.useRealTimers();
  });
});
