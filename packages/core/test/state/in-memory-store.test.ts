import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPlanStore } from '../../src/state/in-memory-store.js';
import type { Task } from '../../src/types/task.js';
import type { Plan } from '../../src/types/plan.js';

function makePlan(id = 'plan-1'): Plan {
  return {
    id,
    interpretation: 'test',
    subtasks: [],
    depth: 0,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    objective: 'Do something',
    plan: makePlan(),
    status: 'PLANNING',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('InMemoryPlanStore', () => {
  let store: InMemoryPlanStore;

  beforeEach(() => {
    store = new InMemoryPlanStore();
  });

  describe('save / load', () => {
    it('saves and loads a task by id', async () => {
      const task = makeTask();
      await store.save(task);

      const loaded = await store.load('task-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('task-1');
      expect(loaded!.objective).toBe('Do something');
    });

    it('returns null for non-existent task', async () => {
      const loaded = await store.load('non-existent');
      expect(loaded).toBeNull();
    });

    it('returns a clone, not a reference', async () => {
      const task = makeTask();
      await store.save(task);

      const loaded = await store.load('task-1');
      loaded!.objective = 'mutated';

      const loadedAgain = await store.load('task-1');
      expect(loadedAgain!.objective).toBe('Do something');
    });
  });

  describe('update', () => {
    it('updates fields of an existing task', async () => {
      await store.save(makeTask());
      await store.update('task-1', { status: 'EXECUTING' });

      const loaded = await store.load('task-1');
      expect(loaded!.status).toBe('EXECUTING');
    });

    it('sets updatedAt on update', async () => {
      const original = makeTask();
      await store.save(original);

      await store.update('task-1', { objective: 'updated' });

      const loaded = await store.load('task-1');
      expect(loaded!.updatedAt.getTime()).toBeGreaterThanOrEqual(original.updatedAt.getTime());
    });

    it('throws for non-existent task', async () => {
      await expect(
        store.update('non-existent', { status: 'COMPLETED' }),
      ).rejects.toThrow('Task "non-existent" not found');
    });
  });

  describe('delete', () => {
    it('removes a task so it cannot be loaded', async () => {
      await store.save(makeTask());
      await store.delete('task-1');

      const loaded = await store.load('task-1');
      expect(loaded).toBeNull();
    });

    it('does not throw when deleting non-existent task', async () => {
      await expect(store.delete('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns all tasks when no filter is given', async () => {
      await store.save(makeTask({ id: 'a' }));
      await store.save(makeTask({ id: 'b' }));
      await store.save(makeTask({ id: 'c' }));

      const tasks = await store.list();
      expect(tasks).toHaveLength(3);
    });

    it('filters by status', async () => {
      await store.save(makeTask({ id: 'a', status: 'PLANNING' }));
      await store.save(makeTask({ id: 'b', status: 'EXECUTING' }));
      await store.save(makeTask({ id: 'c', status: 'COMPLETED' }));

      const executing = await store.list({ status: 'EXECUTING' });
      expect(executing).toHaveLength(1);
      expect(executing[0].id).toBe('b');
    });

    it('filters by createdAfter', async () => {
      await store.save(makeTask({ id: 'old', createdAt: new Date('2024-01-01') }));
      await store.save(makeTask({ id: 'new', createdAt: new Date('2025-06-01') }));

      const filtered = await store.list({ createdAfter: new Date('2025-01-01') });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('new');
    });

    it('filters by createdBefore', async () => {
      await store.save(makeTask({ id: 'old', createdAt: new Date('2024-01-01') }));
      await store.save(makeTask({ id: 'new', createdAt: new Date('2025-06-01') }));

      const filtered = await store.list({ createdBefore: new Date('2025-01-01') });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('old');
    });

    it('combines multiple filters', async () => {
      await store.save(makeTask({
        id: 'a',
        status: 'COMPLETED',
        createdAt: new Date('2025-03-01'),
      }));
      await store.save(makeTask({
        id: 'b',
        status: 'COMPLETED',
        createdAt: new Date('2025-07-01'),
      }));
      await store.save(makeTask({
        id: 'c',
        status: 'EXECUTING',
        createdAt: new Date('2025-03-01'),
      }));

      const filtered = await store.list({
        status: 'COMPLETED',
        createdAfter: new Date('2025-01-01'),
        createdBefore: new Date('2025-06-01'),
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('a');
    });

    it('returns clones of tasks', async () => {
      await store.save(makeTask({ id: 'a' }));

      const tasks = await store.list();
      tasks[0].objective = 'mutated';

      const fresh = await store.list();
      expect(fresh[0].objective).toBe('Do something');
    });

    it('returns empty array when store is empty', async () => {
      const tasks = await store.list();
      expect(tasks).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes all tasks from the store', async () => {
      await store.save(makeTask({ id: 'a' }));
      await store.save(makeTask({ id: 'b' }));

      store.clear();

      const tasks = await store.list();
      expect(tasks).toHaveLength(0);
    });
  });
});
