import type { TraceContext } from '../types/index.js';

let otelAvailable: boolean | null = null;

function generateId(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function createTraceContext(parentSpanId?: string): TraceContext {
  return {
    traceId: generateId(32),
    spanId: generateId(16),
    parentSpanId,
  };
}

export function createChildContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateId(16),
    parentSpanId: parent.spanId,
  };
}

export async function tryGetOTelTracer(): Promise<unknown | null> {
  if (otelAvailable === false) return null;

  try {
    const otel = await import('@opentelemetry/api');
    otelAvailable = true;
    return otel.trace.getTracer('two-layer-cake');
  } catch {
    otelAvailable = false;
    return null;
  }
}
