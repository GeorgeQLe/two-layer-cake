import Anthropic from '@anthropic-ai/sdk';
import type { ErrorDetail } from 'two-layer-cake';

export function classifyError(error: unknown): ErrorDetail {
  if (error instanceof Anthropic.APIUserAbortError) {
    return {
      code: 'LLM_ABORTED',
      message: error.message,
      retryable: false,
      source: 'llm',
      original: error,
    };
  }

  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return {
      code: 'LLM_TIMEOUT',
      message: error.message,
      retryable: true,
      source: 'llm',
      original: error,
    };
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return {
      code: 'LLM_CONNECTION_ERROR',
      message: error.message,
      retryable: true,
      source: 'llm',
      original: error,
    };
  }

  if (error instanceof Anthropic.RateLimitError) {
    return {
      code: 'LLM_RATE_LIMITED',
      message: error.message,
      retryable: true,
      source: 'llm',
      original: error,
    };
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return {
      code: 'LLM_AUTH_ERROR',
      message: error.message,
      retryable: false,
      source: 'llm',
      original: error,
    };
  }

  if (error instanceof Anthropic.BadRequestError) {
    return {
      code: 'LLM_BAD_REQUEST',
      message: error.message,
      retryable: false,
      source: 'llm',
      original: error,
    };
  }

  if (error instanceof Anthropic.InternalServerError) {
    return {
      code: 'LLM_SERVER_ERROR',
      message: error.message,
      retryable: true,
      source: 'llm',
      original: error,
    };
  }

  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status && status >= 500) {
      return {
        code: 'LLM_SERVER_ERROR',
        message: error.message,
        retryable: true,
        source: 'llm',
        original: error,
      };
    }
    return {
      code: 'LLM_UNKNOWN',
      message: error.message,
      retryable: false,
      source: 'llm',
      original: error,
    };
  }

  return {
    code: 'LLM_UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    source: 'llm',
    original: error,
  };
}

export function isRetryable(error: unknown): boolean {
  return classifyError(error).retryable;
}
