import { describe, it, expect } from 'vitest';
import { TokenBudgetTracker } from '../../src/llm/token-budget.js';
import { BudgetExceededError } from '../../src/errors/sdk-errors.js';

describe('TokenBudgetTracker', () => {
  it('starts with full budget remaining', () => {
    const tracker = new TokenBudgetTracker(1000);
    expect(tracker.remaining()).toBe(1000);
    expect(tracker.used()).toBe(0);
  });

  it('consume() reduces remaining tokens', () => {
    const tracker = new TokenBudgetTracker(1000);
    tracker.consume(250);
    expect(tracker.remaining()).toBe(750);
    expect(tracker.used()).toBe(250);
  });

  it('consume() multiple times accumulates usage', () => {
    const tracker = new TokenBudgetTracker(500);
    tracker.consume(100);
    tracker.consume(200);
    expect(tracker.remaining()).toBe(200);
    expect(tracker.used()).toBe(300);
  });

  it('throws on negative token consumption', () => {
    const tracker = new TokenBudgetTracker(1000);
    expect(() => tracker.consume(-1)).toThrow('Cannot consume negative tokens');
  });

  it('hasRemaining() returns true when tokens available', () => {
    const tracker = new TokenBudgetTracker(100);
    expect(tracker.hasRemaining()).toBe(true);
    expect(tracker.hasRemaining(100)).toBe(true);
  });

  it('hasRemaining() returns false when insufficient tokens', () => {
    const tracker = new TokenBudgetTracker(100);
    tracker.consume(90);
    expect(tracker.hasRemaining(11)).toBe(false);
    expect(tracker.hasRemaining(10)).toBe(true);
  });

  it('hasRemaining() defaults to checking for 1 token', () => {
    const tracker = new TokenBudgetTracker(1);
    expect(tracker.hasRemaining()).toBe(true);
    tracker.consume(1);
    expect(tracker.hasRemaining()).toBe(false);
  });

  it('throws BudgetExceededError when consuming more than remaining', () => {
    const tracker = new TokenBudgetTracker(100);
    tracker.consume(80);

    try {
      tracker.consume(30);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const budgetErr = err as BudgetExceededError;
      expect(budgetErr.used).toBe(110);
      expect(budgetErr.budget).toBe(100);
    }
  });

  describe('fork', () => {
    it('creates a child tracker that shares parent budget', () => {
      const parent = new TokenBudgetTracker(1000);
      const child = parent.fork(500);

      child.consume(200);

      // Child consumed 200
      expect(child.remaining()).toBe(300);
      expect(child.used()).toBe(200);

      // Parent also consumed 200 (propagated)
      expect(parent.remaining()).toBe(800);
      expect(parent.used()).toBe(200);
    });

    it('fork without argument uses parent remaining as child budget', () => {
      const parent = new TokenBudgetTracker(1000);
      parent.consume(300);

      const child = parent.fork();
      // Child budget should be parent.remaining() = 700
      expect(child.remaining()).toBe(700);
    });

    it('child cannot exceed parent remaining even if child budget is larger', () => {
      const parent = new TokenBudgetTracker(100);
      parent.consume(80);

      // Child has budget of 50, but parent only has 20 remaining
      const child = parent.fork(50);

      // remaining should be min(50, 20) = 20
      expect(child.remaining()).toBe(20);
    });

    it('throws BudgetExceededError when child exceeds parent budget', () => {
      const parent = new TokenBudgetTracker(100);
      parent.consume(90);

      const child = parent.fork(50);

      // Child has 50 budget but parent only has 10 remaining
      expect(() => child.consume(20)).toThrow(BudgetExceededError);
    });

    it('sibling forks share the same parent budget', () => {
      const parent = new TokenBudgetTracker(1000);
      const child1 = parent.fork(600);
      const child2 = parent.fork(600);

      child1.consume(400);
      // parent now has 600 remaining
      expect(parent.remaining()).toBe(600);

      child2.consume(400);
      // parent now has 200 remaining
      expect(parent.remaining()).toBe(200);

      // child2 has 200 of its 600 budget used, but parent only has 200 left
      expect(child2.remaining()).toBe(200);
    });
  });
});
