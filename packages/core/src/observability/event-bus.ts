import type { OrchestratorEvents, StructuredEvent } from '../types/index.js';

type EventName = keyof OrchestratorEvents;
type EventHandler = (...args: unknown[]) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();
  private structuredListeners = new Set<(event: StructuredEvent) => void>();
  private planId = '';

  setPlanId(planId: string): void {
    this.planId = planId;
  }

  emit<K extends EventName>(type: K, ...args: Parameters<OrchestratorEvents[K]>): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }

    // Also emit as structured event
    const structured: StructuredEvent = {
      timestamp: new Date(),
      type,
      planId: this.planId,
      data: args.length === 1 ? args[0] : args,
    };

    for (const listener of this.structuredListeners) {
      listener(structured);
    }
  }

  on<K extends EventName>(type: K, handler: OrchestratorEvents[K]): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler as EventHandler);
  }

  off<K extends EventName>(type: K, handler: OrchestratorEvents[K]): void {
    this.listeners.get(type)?.delete(handler as EventHandler);
  }

  onStructured(handler: (event: StructuredEvent) => void): void {
    this.structuredListeners.add(handler);
  }

  offStructured(handler: (event: StructuredEvent) => void): void {
    this.structuredListeners.delete(handler);
  }

  toAsyncIterable(): AsyncIterable<StructuredEvent> {
    const queue: StructuredEvent[] = [];
    let resolve: ((value: IteratorResult<StructuredEvent>) => void) | null = null;
    let done = false;

    const handler = (event: StructuredEvent) => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: event, done: false });
      } else {
        queue.push(event);
      }
    };

    this.onStructured(handler);

    const cleanup = () => {
      done = true;
      this.offStructured(handler);
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown as StructuredEvent, done: true });
      }
    };

    // Listen for completion events
    const completionHandler = () => cleanup();
    this.on('plan:completed', completionHandler as OrchestratorEvents['plan:completed']);
    this.on('plan:failed', completionHandler as OrchestratorEvents['plan:failed']);
    this.on('plan:cancelled', completionHandler as OrchestratorEvents['plan:cancelled']);

    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<StructuredEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (done) {
              return Promise.resolve({
                value: undefined as unknown as StructuredEvent,
                done: true,
              });
            }
            return new Promise((r) => {
              resolve = r;
            });
          },
          return(): Promise<IteratorResult<StructuredEvent>> {
            cleanup();
            return Promise.resolve({
              value: undefined as unknown as StructuredEvent,
              done: true,
            });
          },
        };
      },
    };
  }

  removeAllListeners(): void {
    this.listeners.clear();
    this.structuredListeners.clear();
  }
}
