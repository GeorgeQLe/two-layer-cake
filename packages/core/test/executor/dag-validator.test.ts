import { describe, it, expect } from 'vitest';
import { validateDAG } from '../../src/executor/dag-validator.js';
import { DAGCycleError } from '../../src/errors/sdk-errors.js';
import type { Subtask } from '../../src/types/plan.js';

function makeSubtask(id: string, dependsOn: string[] = []): Subtask {
  return {
    id,
    description: `Task ${id}`,
    agentType: 'default',
    dependsOn,
    priority: 'medium',
    status: 'PENDING',
  };
}

describe('validateDAG', () => {
  it('accepts an empty array', () => {
    expect(() => validateDAG([])).not.toThrow();
  });

  it('accepts a valid linear chain (a -> b -> c)', () => {
    const subtasks = [
      makeSubtask('a'),
      makeSubtask('b', ['a']),
      makeSubtask('c', ['b']),
    ];
    expect(() => validateDAG(subtasks)).not.toThrow();
  });

  it('accepts parallel tasks with no dependencies', () => {
    const subtasks = [
      makeSubtask('a'),
      makeSubtask('b'),
      makeSubtask('c'),
    ];
    expect(() => validateDAG(subtasks)).not.toThrow();
  });

  it('accepts a diamond DAG (a -> b,c -> d)', () => {
    const subtasks = [
      makeSubtask('a'),
      makeSubtask('b', ['a']),
      makeSubtask('c', ['a']),
      makeSubtask('d', ['b', 'c']),
    ];
    expect(() => validateDAG(subtasks)).not.toThrow();
  });

  it('throws DAGCycleError for a simple cycle (a -> b -> a)', () => {
    const subtasks = [
      makeSubtask('a', ['b']),
      makeSubtask('b', ['a']),
    ];
    expect(() => validateDAG(subtasks)).toThrow(DAGCycleError);
  });

  it('throws DAGCycleError for a three-node cycle', () => {
    const subtasks = [
      makeSubtask('a', ['c']),
      makeSubtask('b', ['a']),
      makeSubtask('c', ['b']),
    ];
    try {
      validateDAG(subtasks);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DAGCycleError);
      expect((err as DAGCycleError).cycle.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('throws DAGCycleError for a self-referencing task', () => {
    const subtasks = [
      makeSubtask('a', ['a']),
    ];
    expect(() => validateDAG(subtasks)).toThrow(DAGCycleError);
  });

  it('detects a cycle in a larger graph with valid and invalid parts', () => {
    const subtasks = [
      makeSubtask('a'),
      makeSubtask('b', ['a']),
      // c -> d -> e -> c is a cycle
      makeSubtask('c', ['e']),
      makeSubtask('d', ['c']),
      makeSubtask('e', ['d']),
    ];
    expect(() => validateDAG(subtasks)).toThrow(DAGCycleError);
  });

  it('ignores dependencies on unknown task ids', () => {
    const subtasks = [
      makeSubtask('a', ['unknown-id']),
      makeSubtask('b', ['a']),
    ];
    // unknown deps are not in the id set, so they are skipped
    expect(() => validateDAG(subtasks)).not.toThrow();
  });
});
