import { describe, it, expect } from 'vitest';
import { getBuiltInAgent, BUILT_IN_AGENTS } from '../built-in-agents.js';

describe('Built-in agents', () => {
  it('general-purpose, Explore, Plan are all discoverable', () => {
    expect(getBuiltInAgent('general-purpose')).toBeDefined();
    expect(getBuiltInAgent('Explore')).toBeDefined();
    expect(getBuiltInAgent('Plan')).toBeDefined();
  });

  it('Explore is read-only (Write/Edit disallowed)', () => {
    const explore = getBuiltInAgent('Explore')!;
    expect(explore.disallowedTools).toContain('Write');
    expect(explore.disallowedTools).toContain('Edit');
  });

  it('general-purpose has no tool restrictions', () => {
    const gp = getBuiltInAgent('general-purpose')!;
    expect(gp.tools).toBeUndefined();
    expect(gp.disallowedTools).toBeUndefined();
  });

  it('Plan is read-only (Write/Edit disallowed)', () => {
    const plan = getBuiltInAgent('Plan')!;
    expect(plan.disallowedTools).toContain('Write');
    expect(plan.disallowedTools).toContain('Edit');
  });

  it('returns undefined for unknown agent', () => {
    expect(getBuiltInAgent('nonexistent')).toBeUndefined();
  });

  it('lookup is case-sensitive', () => {
    expect(getBuiltInAgent('explore')).toBeUndefined();
    expect(getBuiltInAgent('EXPLORE')).toBeUndefined();
  });

  it('all agents have unique names', () => {
    const names = BUILT_IN_AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
