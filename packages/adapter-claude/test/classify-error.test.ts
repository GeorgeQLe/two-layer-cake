import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { classifyError, isRetryable } from '../src/classify-error.js';

describe('classifyError (Claude)', () => {
  it('classifies APIUserAbortError as LLM_ABORTED, not retryable', () => {
    const error = new Anthropic.APIUserAbortError();
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_ABORTED');
    expect(detail.retryable).toBe(false);
    expect(detail.source).toBe('llm');
  });

  it('classifies APIConnectionTimeoutError as LLM_TIMEOUT, retryable', () => {
    const error = new Anthropic.APIConnectionTimeoutError();
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_TIMEOUT');
    expect(detail.retryable).toBe(true);
  });

  it('classifies APIConnectionError as LLM_CONNECTION_ERROR, retryable', () => {
    const error = new Anthropic.APIConnectionError({ message: 'connection failed' });
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_CONNECTION_ERROR');
    expect(detail.retryable).toBe(true);
  });

  it('classifies RateLimitError as LLM_RATE_LIMITED, retryable', () => {
    const error = new Anthropic.RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
      'rate limited',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_RATE_LIMITED');
    expect(detail.retryable).toBe(true);
  });

  it('classifies AuthenticationError as LLM_AUTH_ERROR, not retryable', () => {
    const error = new Anthropic.AuthenticationError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid api key' } },
      'invalid api key',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_AUTH_ERROR');
    expect(detail.retryable).toBe(false);
  });

  it('classifies BadRequestError as LLM_BAD_REQUEST, not retryable', () => {
    const error = new Anthropic.BadRequestError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'bad request' } },
      'bad request',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_BAD_REQUEST');
    expect(detail.retryable).toBe(false);
  });

  it('classifies InternalServerError as LLM_SERVER_ERROR, retryable', () => {
    const error = new Anthropic.InternalServerError(
      500,
      { type: 'error', error: { type: 'api_error', message: 'internal error' } },
      'internal error',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_SERVER_ERROR');
    expect(detail.retryable).toBe(true);
  });

  it('classifies generic 5xx APIError as LLM_SERVER_ERROR, retryable', () => {
    const error = new Anthropic.APIError(
      502,
      { type: 'error', error: { type: 'api_error', message: 'bad gateway' } },
      'bad gateway',
      {},
    );
    const detail = classifyError(error);
    expect(detail.code).toBe('LLM_SERVER_ERROR');
    expect(detail.retryable).toBe(true);
  });

  it('classifies non-5xx APIError as LLM_UNKNOWN, not retryable', () => {
    const error = new Anthropic.APIError(
      403,
      { type: 'error', error: { type: 'permission_error', message: 'forbidden' } },
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
      expect(isRetryable(new Anthropic.APIConnectionTimeoutError())).toBe(true);
    });

    it('returns false for non-retryable errors', () => {
      expect(isRetryable(new Anthropic.APIUserAbortError())).toBe(false);
    });
  });
});
