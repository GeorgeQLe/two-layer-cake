export interface ErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
  source: 'agent' | 'tool' | 'llm' | 'system';
  original?: unknown;
}

export interface ErrorStrategy {
  strategy: 'retry' | 'reassign' | 'skip' | 'fail';
  delay?: number;
  reassignTo?: string;
  reason?: string;
}
