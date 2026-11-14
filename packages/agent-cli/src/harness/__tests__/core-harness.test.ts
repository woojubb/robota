import { describe, expect, it } from 'vitest';

import { CORE_HARNESS_PROMPT } from '../core-harness.js';

/**
 * The core harness is sent on every run, so its size is part of what a change to it is reviewed
 * against: it is meant to stay a small, general layer and not grow into a rulebook.
 */
describe('the core harness text', () => {
  it('stays within the reviewed size', () => {
    expect(CORE_HARNESS_PROMPT.length).toBeGreaterThanOrEqual(1100);
    expect(CORE_HARNESS_PROMPT.length).toBeLessThanOrEqual(1600);
  });

  it('is plain ASCII, so it reads the same in every terminal and log', () => {
    expect(CORE_HARNESS_PROMPT).toMatch(/^[\x20-\x7e\n]+$/);
  });

  it('has no placeholders to fill and no edge whitespace', () => {
    expect(CORE_HARNESS_PROMPT).not.toMatch(/\{\{|\$\{/);
    expect(CORE_HARNESS_PROMPT).toBe(CORE_HARNESS_PROMPT.trim());
  });
});
