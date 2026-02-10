import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/observability/event-bus.js';
import type { Plan, Subtask } from '../../src/types/plan.js';
import type { AggregatedResult } from '../../src/types/result.js';

function makePlan(): Plan {
  return {
    id: 'plan-1',
    interpretation: 'test plan',
    subtasks: [],
    depth: 0,
  };
}

function makeAggregatedResult(plan: Plan): AggregatedResult {
  return {
    plan,
    results: new Map(),
    aggregatedOutput: null,
    totalDurationMs: 100,
    totalTokensUsed: 50,
  };
}

describe('EventBus', () => {
  describe('emit / on / off', () => {
    it('calls registered listener when event is emitted', () => {
      const bus = new EventBus();
      const handler = vi.fn();

      bus.on('plan:created', handler);
      const plan = makePlan();
      bus.emit('plan:created', plan);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(plan);
    });

    it('supports multiple listeners for the same event', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();

      bus.on('plan:created', h1);
      bus.on('plan:created', h2);
      bus.emit('plan:created', makePlan());

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('removes a listener with off()', () => {
      const bus = new EventBus();
      const handler = vi.fn();

      bus.on('plan:created', handler);
      bus.off('plan:created', handler);
      bus.emit('plan:created', makePlan());

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not call listeners for different event types', () => {
      const bus = new EventBus();
      const handler = vi.fn();

      bus.on('plan:created', handler);
      bus.emit('plan:cancelled', makePlan());

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('structured events', () => {
    it('emits structured events to onStructured listeners', () => {
      const bus = new EventBus();
      const structured = vi.fn();

      bus.onStructured(structured);
      bus.setPlanId('plan-abc');
      bus.emit('plan:created', makePlan());

      expect(structured).toHaveBeenCalledTimes(1);
      const event = structured.mock.calls[0][0];
      expect(event.type).toBe('plan:created');
      expect(event.planId).toBe('plan-abc');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.data).toBeDefined();
    });

    it('wraps single arg as data directly', () => {
      const bus = new EventBus();
      const structured = vi.fn();
      bus.onStructured(structured);

      const plan = makePlan();
      bus.emit('plan:created', plan);

      expect(structured.mock.calls[0][0].data).toBe(plan);
    });

    it('wraps multiple args as array', () => {
      const bus = new EventBus();
      const structured = vi.fn();
      bus.onStructured(structured);

      const plan = makePlan();
      const result = makeAggregatedResult(plan);
      bus.emit('plan:completed', plan, result);

      const data = structured.mock.calls[0][0].data;
      expect(Array.isArray(data)).toBe(true);
      expect(data).toEqual([plan, result]);
    });

    it('removes structured listener with offStructured()', () => {
      const bus = new EventBus();
      const handler = vi.fn();

      bus.onStructured(handler);
      bus.offStructured(handler);
      bus.emit('plan:created', makePlan());

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('toAsyncIterable', () => {
    it('yields structured events as they are emitted', async () => {
      const bus = new EventBus();
      const iterable = bus.toAsyncIterable();
      const iterator = iterable[Symbol.asyncIterator]();

      const plan = makePlan();
      bus.emit('plan:created', plan);

      const { value, done } = await iterator.next();
      expect(done).toBe(false);
      expect(value.type).toBe('plan:created');
    });

    it('completes when plan:completed is emitted', async () => {
      const bus = new EventBus();
      const iterable = bus.toAsyncIterable();
      const iterator = iterable[Symbol.asyncIterator]();

      // Emit a regular event first, then the completion event
      const plan = makePlan();
      bus.emit('plan:created', plan);
      bus.emit('plan:completed', plan, makeAggregatedResult(plan));

      // The first queued event should be yielded
      const first = await iterator.next();
      expect(first.value.type).toBe('plan:created');

      // After the completion event, iterator should be done
      const second = await iterator.next();
      expect(second.done).toBe(true);
    });

    it('completes on return()', async () => {
      const bus = new EventBus();
      const iterable = bus.toAsyncIterable();
      const iterator = iterable[Symbol.asyncIterator]();

      const result = await iterator.return!();
      expect(result.done).toBe(true);
    });

    it('queues events emitted before next() is called', async () => {
      const bus = new EventBus();
      const iterable = bus.toAsyncIterable();
      const iterator = iterable[Symbol.asyncIterator]();

      const plan = makePlan();
      bus.emit('plan:created', plan);
      bus.emit('plan:executing', plan);

      const first = await iterator.next();
      expect(first.value.type).toBe('plan:created');

      const second = await iterator.next();
      expect(second.value.type).toBe('plan:executing');
    });
  });

  describe('removeAllListeners', () => {
    it('removes all event and structured listeners', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      const structured = vi.fn();

      bus.on('plan:created', handler);
      bus.onStructured(structured);

      bus.removeAllListeners();

      bus.emit('plan:created', makePlan());

      expect(handler).not.toHaveBeenCalled();
      expect(structured).not.toHaveBeenCalled();
    });
  });
});
