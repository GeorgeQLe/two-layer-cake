import { describe, it, expect, vi } from 'vitest';
import { ConcurrencyPool } from '../../src/executor/concurrency-pool.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('ConcurrencyPool', () => {
  it('runs tasks under the concurrency limit immediately', async () => {
    const pool = new ConcurrencyPool(3);
    const results: number[] = [];

    await Promise.all([
      pool.run(async () => { results.push(1); }),
      pool.run(async () => { results.push(2); }),
    ]);

    expect(results).toEqual([1, 2]);
  });

  it('queues tasks when at the concurrency limit', async () => {
    const pool = new ConcurrencyPool(1);
    const order: string[] = [];

    const p1 = pool.run(async () => {
      await delay(30);
      order.push('first');
    });

    const p2 = pool.run(async () => {
      order.push('second');
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(['first', 'second']);
  });

  it('releases slot on completion so queued tasks run', async () => {
    const pool = new ConcurrencyPool(2);
    const running: string[] = [];
    const completed: string[] = [];

    const task = (name: string, ms: number) =>
      pool.run(async () => {
        running.push(name);
        await delay(ms);
        completed.push(name);
      });

    const p1 = task('a', 50);
    const p2 = task('b', 50);
    const p3 = task('c', 10);

    await Promise.all([p1, p2, p3]);
    // 'c' should only start after 'a' or 'b' finishes
    expect(completed).toContain('a');
    expect(completed).toContain('b');
    expect(completed).toContain('c');
  });

  it('tracks activeCount and pendingCount', async () => {
    const pool = new ConcurrencyPool(1);
    expect(pool.activeCount).toBe(0);
    expect(pool.pendingCount).toBe(0);

    let resolveFirst!: () => void;
    const firstBlocker = new Promise<void>((r) => { resolveFirst = r; });

    const p1 = pool.run(() => firstBlocker);

    // Allow microtask to settle so acquire completes
    await delay(1);

    expect(pool.activeCount).toBe(1);

    const p2 = pool.run(async () => 'queued');

    await delay(1);
    expect(pool.pendingCount).toBe(1);

    resolveFirst();
    await Promise.all([p1, p2]);

    expect(pool.activeCount).toBe(0);
    expect(pool.pendingCount).toBe(0);
  });

  it('throws immediately when abort signal is already aborted', async () => {
    const pool = new ConcurrencyPool(2);
    const controller = new AbortController();
    controller.abort();

    await expect(
      pool.run(async () => 'should not run', controller.signal),
    ).rejects.toThrow('Aborted');
  });

  it('aborts a queued task when signal fires', async () => {
    const pool = new ConcurrencyPool(1);
    const controller = new AbortController();

    let resolveFirst!: () => void;
    const blocker = new Promise<void>((r) => { resolveFirst = r; });

    const p1 = pool.run(() => blocker);

    // Queue a second task that will be waiting
    const p2 = pool.run(async () => 'queued-result', controller.signal);

    await delay(1);
    expect(pool.pendingCount).toBe(1);

    controller.abort();

    await expect(p2).rejects.toThrow('Aborted');

    // Pending should drop to 0 after abort removes from queue
    expect(pool.pendingCount).toBe(0);

    resolveFirst();
    await p1;
  });

  it('releases slot even when task throws', async () => {
    const pool = new ConcurrencyPool(1);

    await expect(
      pool.run(async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');

    // Slot should be freed so next task can run
    const result = await pool.run(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(pool.activeCount).toBe(0);
  });
});
