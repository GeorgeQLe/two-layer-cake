import { describe, it, expect } from 'vitest';
import { PlanSchema, SubtaskSchema, validatePlanSchema } from '../../src/planner/plan-schema.js';

describe('SubtaskSchema', () => {
  it('validates a valid subtask', () => {
    const result = SubtaskSchema.parse({
      id: 's1',
      description: 'do something',
      agentType: 'researcher',
    });
    expect(result.id).toBe('s1');
    expect(result.dependsOn).toEqual([]);
    expect(result.priority).toBe('medium');
  });

  it('applies default dependsOn and priority', () => {
    const result = SubtaskSchema.parse({
      id: 's2',
      description: 'task',
      agentType: 'worker',
    });
    expect(result.dependsOn).toEqual([]);
    expect(result.priority).toBe('medium');
  });

  it('rejects missing required fields', () => {
    expect(() => SubtaskSchema.parse({ id: 's1' })).toThrow();
    expect(() => SubtaskSchema.parse({ description: 'x', agentType: 'a' })).toThrow();
  });
});

describe('PlanSchema', () => {
  it('validates a valid plan', () => {
    const data = {
      interpretation: 'understand the task',
      subtasks: [
        { id: 's1', description: 'research', agentType: 'researcher' },
      ],
    };
    const result = PlanSchema.parse(data);
    expect(result.interpretation).toBe('understand the task');
    expect(result.subtasks).toHaveLength(1);
    expect(result.reasoning).toBeUndefined();
  });

  it('accepts optional reasoning', () => {
    const data = {
      interpretation: 'test',
      subtasks: [],
      reasoning: 'because reasons',
    };
    const result = PlanSchema.parse(data);
    expect(result.reasoning).toBe('because reasons');
  });

  it('rejects missing interpretation', () => {
    expect(() => PlanSchema.parse({ subtasks: [] })).toThrow();
  });

  it('rejects missing subtasks', () => {
    expect(() => PlanSchema.parse({ interpretation: 'ok' })).toThrow();
  });
});

describe('validatePlanSchema', () => {
  it('returns parsed output for valid data', () => {
    const result = validatePlanSchema({
      interpretation: 'test',
      subtasks: [{ id: 'a', description: 'b', agentType: 'c' }],
    });
    expect(result.interpretation).toBe('test');
    expect(result.subtasks[0].dependsOn).toEqual([]);
  });

  it('throws for invalid data', () => {
    expect(() => validatePlanSchema({})).toThrow();
  });
});
