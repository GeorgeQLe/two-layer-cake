import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('core', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('1.0.0');
  });
});
