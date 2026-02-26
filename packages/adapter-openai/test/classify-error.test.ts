import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { classifyError, isRetryable } from '../src/classify-error.js';

describe('classifyError (OpenAI)', () => {
  it('classifies APIUserAbortError as LLM_ABORTED, not retryable', () => {
    const error = new OpenAI.APIUserAbortError();
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_ABORTED');
    expect(detail.retryable).toBe(false);
    expect(detail.source).toBe('llm');
  });

  it('classifies APIConnectionTimeoutError as LLM_TIMEOUT, retryable', () => {
    const error = new OpenAI.APIConnectionTimeoutError();
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_TIMEOUT');
    expect(detail.retryable).toBe(true);
  });

  it('classifies APIConnectionError as LLM_CONNECTION_ERROR, retryable', () => {
    const error = new OpenAI.APIConnectionError({ message: 'connection failed' });
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_CONNECTION_ERROR');
    expect(detail.retryable).toBe(true);
  });

  it('classifies RateLimitError as LLM_RATE_LIMITED, retryable', () => {
    const error = new OpenAI.RateLimitError(
      429,
      { error: { message: 'rate limited', type: 'rate_limit_error', code: null, param: null } },
      'rate limited',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_RATE_LIMITED');
    expect(detail.retryable).toBe(true);
  });

  it('classifies AuthenticationError as LLM_AUTH_ERROR, not retryable', () => {
    const error = new OpenAI.AuthenticationError(
      401,
      { error: { message: 'invalid api key', type: 'auth_error', code: null, param: null } },
      'invalid api key',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_AUTH_ERROR');
    expect(detail.retryable).toBe(false);
  });

  it('classifies BadRequestError as LLM_BAD_REQUEST, not retryable', () => {
    const error = new OpenAI.BadRequestError(
      400,
      { error: { message: 'bad request', type: 'invalid_request_error', code: null, param: null } },
      'bad request',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_BAD_REQUEST');
    expect(detail.retryable).toBe(false);
  });

  it('classifies InternalServerError as LLM_SERVER_ERROR, retryable', () => {
    const error = new OpenAI.InternalServerError(
      500,
      { error: { message: 'internal error', type: 'server_error', code: null, param: null } },
      'internal error',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_SERVER_ERROR');
    expect(detail.retryable).toBe(true);
  });

  it('classifies generic 5xx APIError as LLM_SERVER_ERROR, retryable', () => {
    const error = new OpenAI.APIError(
      502,
      { error: { message: 'bad gateway', type: 'server_error', code: null, param: null } },
      'bad gateway',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_SERVER_ERROR');
    expect(detail.retryable).toBe(true);
  });

  it('classifies non-5xx APIError as LLM_UNKNOWN, not retryable', () => {
    const error = new OpenAI.APIError(
      403,
      { error: { message: 'forbidden', type: 'permission_error', code: null, param: null } },
      'forbidden',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_UNKNOWN');
    expect(detail.retryable).toBe(false);
  });

  it('classifies non-SDK errors as LLM_UNKNOWN', () => {
    const detail = classifyError(new Error('random error'));
    expect(detail.code).toBe('LLM_UNKNOWN');
    expect(detail.retryable).toBe(false);
  });

  it('classifies non-Error values as LLM_UNKNOWN', () => {
    const detail = classifyError('string error');
    expect(detail.code).toBe('LLM_UNKNOWN');
    expect(detail.message).toBe('string error');
  });

  describe('isRetryable', () => {
    it('returns true for retryable errors', () => {
      expect(isRetryable(new OpenAI.APIConnectionTimeoutError())).toBe(true);
    });

    it('returns false for non-retryable errors', () => {
      expect(isRetryable(new OpenAI.APIUserAbortError())).toBe(false);
    });
  });
});
