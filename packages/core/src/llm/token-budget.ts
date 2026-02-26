import { BudgetExceededError } from '../errors/sdk-errors.js';

export class TokenBudgetTracker {
  private consumed = 0;
  private parent: TokenBudgetTracker | null;

  constructor(
    private readonly totalBudget: number,
    parent?: TokenBudgetTracker,
  ) {
    this.parent = parent ?? null;
  }

  consume(tokens: number): void {
    if (tokens < 0) {
      throw new Error('Cannot consume negative tokens');
    }

    if (!this.hasRemaining(tokens)) {
      throw new BudgetExceededError(this.totalUsed() + tokens, this.effectiveBudget());
    }

    this.consumed += tokens;
    this.parent?.consume(tokens);
  }

  remaining(): number {
    if (this.parent) {
      return Math.min(this.totalBudget - this.consumed, this.parent.remaining());
    }
    return this.totalBudget - this.consumed;
  }

  hasRemaining(needed = 1): boolean {
    return this.remaining() >= needed;
  }

  used(): number {
    return this.consumed;
  }

  percentage(): number {
    const budget = this.effectiveBudget();
    if (budget <= 0) return 0;
    return (this.consumed / budget) * 100;
  }

  fork(childBudget?: number): TokenBudgetTracker {
    const budget = childBudget ?? this.remaining();
    return new TokenBudgetTracker(budget, this);
  }

  private totalUsed(): number {
    return this.consumed;
  }

  private effectiveBudget(): number {
    if (this.parent) {
      return Math.min(this.totalBudget, this.parent.remaining() + this.consumed);
    }
    return this.totalBudget;
  }
}
