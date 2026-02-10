import type { Plan, AggregatedResult } from '../types/index.js';
import type { TestOrchestrator } from './test-orchestrator.js';

export function expectPlanToHaveSubtasks(plan: Plan, count: number): void {
  if (plan.subtasks.length !== count) {
    throw new Error(
      `Expected plan to have ${count} subtasks, but got ${plan.subtasks.length}`,
    );
  }
}

export function expectAgentCalled(
  orchestrator: TestOrchestrator,
  agentName: string,
): void {
  const found = orchestrator.agentCalls.some((c) => c.agent === agentName);
  if (!found) {
    const called = orchestrator.agentCalls.map((c) => c.agent).join(', ');
    throw new Error(
      `Expected agent "${agentName}" to be called, but only these agents were called: ${called || 'none'}`,
    );
  }
}

export function expectAgentNotCalled(
  orchestrator: TestOrchestrator,
  agentName: string,
): void {
  const found = orchestrator.agentCalls.some((c) => c.agent === agentName);
  if (found) {
    throw new Error(`Expected agent "${agentName}" NOT to be called, but it was`);
  }
}

export function expectEventEmitted(
  orchestrator: TestOrchestrator,
  eventType: string,
): void {
  const found = orchestrator.events.some((e) => e.type === eventType);
  if (!found) {
    const emitted = [...new Set(orchestrator.events.map((e) => e.type))].join(', ');
    throw new Error(
      `Expected event "${eventType}" to be emitted, but only these events were emitted: ${emitted || 'none'}`,
    );
  }
}

export function expectResultSuccess(result: AggregatedResult): void {
  const failedCount = Array.from(result.results.values()).filter(
    (r) => r.status === 'failed',
  ).length;

  if (failedCount > 0) {
    throw new Error(
      `Expected all results to succeed, but ${failedCount} failed`,
    );
  }
}

export function expectSubtaskResultCount(
  result: AggregatedResult,
  count: number,
): void {
  if (result.results.size !== count) {
    throw new Error(
      `Expected ${count} subtask results, but got ${result.results.size}`,
    );
  }
}
