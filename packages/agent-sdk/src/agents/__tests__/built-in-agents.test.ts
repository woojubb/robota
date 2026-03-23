import { describe, it, expect } from 'vitest';
import { getBuiltInAgent, BUILT_IN_AGENTS } from '../built-in-agents.js';

describe('Built-in agents', () => {
  it('should have general-purpose, Explore, and Plan', () => {
    expect(BUILT_IN_AGENTS).toHaveLength(3);
    expect(BUILT_IN_AGENTS.map((a) => a.name)).toEqual(['general-purpose', 'Explore', 'Plan']);
  });

  it('should return agent by name', () => {
    const explore = getBuiltInAgent('Explore');
    expect(explore).toBeDefined();
    expect(explore!.model).toBe('claude-haiku-4-5');
    expect(explore!.disallowedTools).toContain('Write');
    expect(explore!.disallowedTools).toContain('Edit');
  });

  it('general-purpose should have no tool restrictions', () => {
    const gp = getBuiltInAgent('general-purpose');
    expect(gp).toBeDefined();
    expect(gp!.model).toBeUndefined();
    expect(gp!.tools).toBeUndefined();
    expect(gp!.disallowedTools).toBeUndefined();
  });

  it('Plan should be read-only with inherited model', () => {
    const plan = getBuiltInAgent('Plan');
    expect(plan).toBeDefined();
    expect(plan!.model).toBeUndefined();
    expect(plan!.disallowedTools).toContain('Write');
    expect(plan!.disallowedTools).toContain('Edit');
  });

  it('should return undefined for unknown agent', () => {
    expect(getBuiltInAgent('nonexistent')).toBeUndefined();
  });

  it('all agents should have non-empty systemPrompt', () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.systemPrompt.length).toBeGreaterThan(0);
    }
  });
});
