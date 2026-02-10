import { describe, it, expect } from 'vitest';
import {
  createTraceContext,
  createChildContext,
} from '../../src/observability/trace-context.js';

describe('createTraceContext', () => {
  it('generates a traceId of 32 hex characters', () => {
    const ctx = createTraceContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates a spanId of 16 hex characters', () => {
    const ctx = createTraceContext();
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('has no parentSpanId by default', () => {
    const ctx = createTraceContext();
    expect(ctx.parentSpanId).toBeUndefined();
  });

  it('sets parentSpanId when provided', () => {
    const ctx = createTraceContext('parent-span-abc');
    expect(ctx.parentSpanId).toBe('parent-span-abc');
  });

  it('generates unique traceIds across calls', () => {
    const a = createTraceContext();
    const b = createTraceContext();
    expect(a.traceId).not.toBe(b.traceId);
  });
});

describe('createChildContext', () => {
  it('preserves the parent traceId', () => {
    const parent = createTraceContext();
    const child = createChildContext(parent);
    expect(child.traceId).toBe(parent.traceId);
  });

  it('generates a new spanId different from parent', () => {
    const parent = createTraceContext();
    const child = createChildContext(parent);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('sets parentSpanId to the parent spanId', () => {
    const parent = createTraceContext();
    const child = createChildContext(parent);
    expect(child.parentSpanId).toBe(parent.spanId);
  });

  it('supports chaining to create grandchild contexts', () => {
    const root = createTraceContext();
    const child = createChildContext(root);
    const grandchild = createChildContext(child);

    expect(grandchild.traceId).toBe(root.traceId);
    expect(grandchild.parentSpanId).toBe(child.spanId);
    expect(grandchild.spanId).not.toBe(child.spanId);
    expect(grandchild.spanId).not.toBe(root.spanId);
  });
});
