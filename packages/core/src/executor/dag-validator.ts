import type { Subtask } from '../types/index.js';
import { DAGCycleError } from '../errors/sdk-errors.js';

export function validateDAG(subtasks: Subtask[]): void {
  const adjacency = new Map<string, string[]>();
  const ids = new Set<string>();

  for (const subtask of subtasks) {
    ids.add(subtask.id);
    adjacency.set(subtask.id, subtask.dependsOn);
  }

  // Kahn's algorithm for topological sort / cycle detection
  const inDegree = new Map<string, number>();
  for (const id of ids) {
    inDegree.set(id, 0);
  }

  for (const subtask of subtasks) {
    for (const dep of subtask.dependsOn) {
      if (ids.has(dep)) {
        inDegree.set(subtask.id, (inDegree.get(subtask.id) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const subtask of subtasks) {
      if (subtask.dependsOn.includes(current)) {
        const newDegree = (inDegree.get(subtask.id) ?? 0) - 1;
        inDegree.set(subtask.id, newDegree);
        if (newDegree === 0) {
          queue.push(subtask.id);
        }
      }
    }
  }

  if (sorted.length !== ids.size) {
    // Find cycle using DFS
    const cycle = findCycle(subtasks);
    throw new DAGCycleError(cycle);
  }
}

function findCycle(subtasks: Subtask[]): string[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const ids = new Set(subtasks.map((s) => s.id));

  for (const id of ids) {
    color.set(id, WHITE);
  }

  for (const id of ids) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id, subtasks, color, parent, ids);
      if (cycle) return cycle;
    }
  }

  return ['unknown cycle'];
}

function dfs(
  node: string,
  subtasks: Subtask[],
  color: Map<string, number>,
  parent: Map<string, string | null>,
  ids: Set<string>,
): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  color.set(node, GRAY);

  const subtask = subtasks.find((s) => s.id === node);
  if (subtask) {
    for (const dep of subtask.dependsOn) {
      if (!ids.has(dep)) continue;

      if (color.get(dep) === GRAY) {
        // Found cycle: reconstruct
        const cycle = [dep, node];
        let current = node;
        while (current !== dep) {
          const p = parent.get(current);
          if (p === null || p === undefined) break;
          cycle.push(p);
          current = p;
        }
        return cycle.reverse();
      }

      if (color.get(dep) === WHITE) {
        parent.set(dep, node);
        const cycle = dfs(dep, subtasks, color, parent, ids);
        if (cycle) return cycle;
      }
    }
  }

  color.set(node, BLACK);
  return null;
}
