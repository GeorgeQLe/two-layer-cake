import type { PlanStoreAdapter, Task, TaskFilter } from '../types/index.js';

export class InMemoryPlanStore implements PlanStoreAdapter {
  private store = new Map<string, Task>();

  async save(task: Task): Promise<void> {
    this.store.set(task.id, structuredClone(task));
  }

  async load(taskId: string): Promise<Task | null> {
    const task = this.store.get(taskId);
    return task ? structuredClone(task) : null;
  }

  async update(taskId: string, changes: Partial<Task>): Promise<void> {
    const existing = this.store.get(taskId);
    if (!existing) {
      throw new Error(`Task "${taskId}" not found`);
    }
    this.store.set(taskId, { ...existing, ...changes, updatedAt: new Date() });
  }

  async delete(taskId: string): Promise<void> {
    this.store.delete(taskId);
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    let tasks = Array.from(this.store.values());

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.createdAfter) {
      tasks = tasks.filter((t) => t.createdAt >= filter.createdAfter!);
    }
    if (filter?.createdBefore) {
      tasks = tasks.filter((t) => t.createdAt <= filter.createdBefore!);
    }

    return tasks.map((t) => structuredClone(t));
  }

  clear(): void {
    this.store.clear();
  }
}
