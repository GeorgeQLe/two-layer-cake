export class ConcurrencyPool {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    await this.acquire(signal);

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const onRelease = () => {
        signal?.removeEventListener('abort', onAbort);
        this.running++;
        resolve();
      };

      const onAbort = () => {
        const index = this.queue.indexOf(onRelease);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error('Aborted'));
      };

      this.queue.push(onRelease);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}
