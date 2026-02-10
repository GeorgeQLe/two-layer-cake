import { describe, it, expect } from 'vitest';
import {
  DAGCycleError,
  BudgetExceededError,
  SubtaskTimeoutError,
  ToolAccessDeniedError,
  ToolConfirmationDeniedError,
  PlanValidationError,
  SDKError,
} from '../../src/errors/sdk-errors.js';

describe('SDKError subclasses', () => {
  describe('DAGCycleError', () => {
    it('extends Error', () => {
      const err = new DAGCycleError(['a', 'b', 'a']);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SDKError);
    });

    it('has correct properties', () => {
      const cycle = ['task-1', 'task-2', 'task-1'];
      const err = new DAGCycleError(cycle);
      expect(err.name).toBe('DAGCycleError');
      expect(err.code).toBe('DAG_CYCLE');
      expect(err.retryable).toBe(false);
      expect(err.source).toBe('system');
      expect(err.cycle).toEqual(cycle);
      expect(err.message).toContain('task-1 -> task-2 -> task-1');
    });

    it('toErrorDetail() returns plain object', () => {
      const err = new DAGCycleError(['a', 'b']);
      const detail = err.toErrorDetail();
      expect(detail.code).toBe('DAG_CYCLE');
      expect(detail.message).toBe(err.message);
      expect(detail.retryable).toBe(false);
      expect(detail.source).toBe('system');
      expect(detail.original).toBeUndefined();
    });
  });

  describe('BudgetExceededError', () => {
    it('extends Error and SDKError', () => {
      const err = new BudgetExceededError(1500, 1000);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SDKError);
    });

    it('has correct properties', () => {
      const err = new BudgetExceededError(1500, 1000);
      expect(err.name).toBe('BudgetExceededError');
      expect(err.code).toBe('BUDGET_EXCEEDED');
      expect(err.retryable).toBe(false);
      expect(err.source).toBe('system');
      expect(err.used).toBe(1500);
      expect(err.budget).toBe(1000);
      expect(err.message).toContain('1500');
      expect(err.message).toContain('1000');
    });

    it('toErrorDetail() works', () => {
      const err = new BudgetExceededError(200, 100);
      const detail = err.toErrorDetail();
      expect(detail.code).toBe('BUDGET_EXCEEDED');
      expect(detail.retryable).toBe(false);
    });
  });

  describe('SubtaskTimeoutError', () => {
    it('extends Error and SDKError', () => {
      const err = new SubtaskTimeoutError('sub-1', 5000);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SDKError);
    });

    it('has correct properties', () => {
      const err = new SubtaskTimeoutError('sub-1', 5000);
      expect(err.name).toBe('SubtaskTimeoutError');
      expect(err.code).toBe('SUBTASK_TIMEOUT');
      expect(err.retryable).toBe(true);
      expect(err.source).toBe('system');
      expect(err.subtaskId).toBe('sub-1');
      expect(err.timeoutMs).toBe(5000);
      expect(err.message).toContain('sub-1');
      expect(err.message).toContain('5000');
    });

    it('toErrorDetail() works', () => {
      const detail = new SubtaskTimeoutError('x', 100).toErrorDetail();
      expect(detail.code).toBe('SUBTASK_TIMEOUT');
      expect(detail.retryable).toBe(true);
    });
  });

  describe('ToolAccessDeniedError', () => {
    it('extends Error and SDKError', () => {
      const err = new ToolAccessDeniedError('delete-file', 'reader-agent');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SDKError);
    });

    it('has correct properties', () => {
      const err = new ToolAccessDeniedError('delete-file', 'reader-agent');
      expect(err.name).toBe('ToolAccessDeniedError');
      expect(err.code).toBe('TOOL_ACCESS_DENIED');
      expect(err.retryable).toBe(false);
      expect(err.source).toBe('system');
      expect(err.toolName).toBe('delete-file');
      expect(err.agentName).toBe('reader-agent');
      expect(err.message).toContain('reader-agent');
      expect(err.message).toContain('delete-file');
    });

    it('toErrorDetail() works', () => {
      const detail = new ToolAccessDeniedError('t', 'a').toErrorDetail();
      expect(detail.code).toBe('TOOL_ACCESS_DENIED');
      expect(detail.retryable).toBe(false);
    });
  });

  describe('ToolConfirmationDeniedError', () => {
    it('extends Error and SDKError', () => {
      const err = new ToolConfirmationDeniedError('deploy');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SDKError);
    });

    it('has correct properties', () => {
      const err = new ToolConfirmationDeniedError('deploy');
      expect(err.name).toBe('ToolConfirmationDeniedError');
      expect(err.code).toBe('TOOL_CONFIRMATION_DENIED');
      expect(err.retryable).toBe(false);
      expect(err.source).toBe('system');
      expect(err.toolName).toBe('deploy');
      expect(err.message).toContain('deploy');
    });

    it('toErrorDetail() works', () => {
      const detail = new ToolConfirmationDeniedError('x').toErrorDetail();
      expect(detail.code).toBe('TOOL_CONFIRMATION_DENIED');
    });
  });

  describe('PlanValidationError', () => {
    it('extends Error and SDKError', () => {
      const err = new PlanValidationError(['missing agent', 'invalid dep']);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SDKError);
    });

    it('has correct properties', () => {
      const details = ['missing agent type', 'cyclic dependency'];
      const err = new PlanValidationError(details);
      expect(err.name).toBe('PlanValidationError');
      expect(err.code).toBe('PLAN_VALIDATION');
      expect(err.retryable).toBe(false);
      expect(err.source).toBe('system');
      expect(err.details).toEqual(details);
      expect(err.message).toContain('missing agent type');
      expect(err.message).toContain('cyclic dependency');
    });

    it('toErrorDetail() works', () => {
      const detail = new PlanValidationError(['bad']).toErrorDetail();
      expect(detail.code).toBe('PLAN_VALIDATION');
      expect(detail.retryable).toBe(false);
      expect(detail.source).toBe('system');
    });
  });
});
