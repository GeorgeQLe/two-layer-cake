import type { ErrorDetail, ErrorStrategy, LLMAdapter, Plan, Subtask } from '../types/index.js';
import type { HookRunner } from '../hooks/hook-runner.js';
import type { EventBus } from '../observability/event-bus.js';
import { z } from 'zod';
import { retry } from './retry.js';

export interface ErrorHandlerConfig {
  hookRunner: HookRunner;
  llm: LLMAdapter;
  eventBus?: EventBus;
  maxRetries?: number;
  baseDelayMs?: number;
}

const LLMErrorStrategySchema = z.object({
  strategy: z.enum(['retry', 'reassign', 'skip', 'fail']),
  reason: z.string().optional(),
});

export class ErrorHandler {
  private readonly hookRunner: HookRunner;
  private readonly llm: LLMAdapter;
  private readonly eventBus?: EventBus;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(config: ErrorHandlerConfig) {
    this.hookRunner = config.hookRunner;
    this.llm = config.llm;
    this.eventBus = config.eventBus;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 1000;
  }

  async handle(
    error: ErrorDetail,
    plan: Plan,
    subtask: Subtask | undefined,
    retryCount: number,
    retryFn?: () => Promise<unknown>,
  ): Promise<ErrorStrategy> {
    // Step 1: Check onError hook for override
    const hookResult = await this.hookRunner.run('onError', error, {
      plan,
      subtask,
      retryCount,
    });

    if (hookResult) {
      return hookResult;
    }

    // Step 2: Rule-based retry if retryable
    if (error.retryable && retryCount < this.maxRetries && retryFn) {
      return {
        strategy: 'retry',
        delay: this.baseDelayMs * Math.pow(2, retryCount),
      };
    }

    // Step 3: LLM escalation after retry exhaustion
    return this.escalateToLLM(error, plan, subtask);
  }

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    plan: Plan,
    subtask: Subtask | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    return retry(fn, {
      maxRetries: this.maxRetries,
      baseDelayMs: this.baseDelayMs,
      signal,
    });
  }

  private async escalateToLLM(
    error: ErrorDetail,
    plan: Plan,
    subtask: Subtask | undefined,
  ): Promise<ErrorStrategy> {
    try {
      const messages = [
        {
          role: 'system' as const,
          content: `You are an error handler for an AI agent orchestration system. An error occurred during plan execution. Analyze the error and decide the best recovery strategy.

Respond with one of these strategies:
- "retry": Retry the failed operation
- "reassign": Assign the subtask to a different agent
- "skip": Skip the failed subtask and continue
- "fail": Abort the entire plan

Respond with a JSON object: { "strategy": "...", "reason": "..." }`,
        },
        {
          role: 'user' as const,
          content: `Error: ${error.code} - ${error.message}
Source: ${error.source}
Retryable: ${error.retryable}
Plan: ${plan.interpretation}
${subtask ? `Subtask: ${subtask.id} - ${subtask.description} (agent: ${subtask.agentType})` : 'No specific subtask'}`,
        },
      ];

      const result = await this.llm.complete(messages);

      let jsonContent: unknown;
      try {
        jsonContent = JSON.parse(result.content);
      } catch (parseError) {
        this.eventBus?.emit('agent:progress', 'error-handler', {
          type: 'llm_response_parse_failure',
          rawContent: result.content,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        jsonContent = null;
      }

      if (jsonContent != null) {
        const parsed = LLMErrorStrategySchema.safeParse(jsonContent);
        if (parsed.success) {
          return {
            strategy: parsed.data.strategy,
            reason: parsed.data.reason,
          };
        }
        this.eventBus?.emit('agent:progress', 'error-handler', {
          type: 'llm_response_schema_mismatch',
          content: jsonContent,
          zodErrors: parsed.error.issues,
        });
      }
    } catch (llmError) {
      this.eventBus?.emit('agent:progress', 'error-handler', {
        type: 'llm_escalation_failed',
        error: llmError instanceof Error ? llmError.message : String(llmError),
      });
    }

    // Default: fail
    return {
      strategy: 'fail',
      reason: `Unrecoverable error: ${error.message}`,
    };
  }
}
