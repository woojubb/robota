import { describe, expect, it } from 'vitest';
import { LocalDagRunner } from '../local-runner/local-dag-runner.js';

describe('LocalDagRunner', () => {
  it('constructs with an empty node list without throwing', () => {
    expect(() => new LocalDagRunner([])).not.toThrow();
  });

  it('exposes a run-progress event bus', () => {
    const runner = new LocalDagRunner([]);
    expect(runner.events).toBeDefined();
    expect(typeof runner.events.subscribe).toBe('function');
  });
});
