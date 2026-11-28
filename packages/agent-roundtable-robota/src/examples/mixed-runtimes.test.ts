import { afterEach, describe, expect, it } from 'vitest';
import { clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import { runMixedRuntimes } from './mixed-runtimes';

afterEach(() => {
  clearRegisteredToolProfiles();
});

describe('mixed runtimes example', () => {
  it('runs an agent, a Session and a hand-written participant in one conversation', async () => {
    const { result, transcript, providerCalls } = await runMixedRuntimes();
    expect(result).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(transcript).toEqual([
      'drafter: Draft: the cache is cleared on every deploy.',
      'reviewer: Review: clear it lazily instead.',
      // The counter read both messages the other two published.
      expect.stringMatching(/^counter: \d+ words so far, no model involved\.$/),
    ]);
    // One provider call each, from the participant that owns the provider and nobody else.
    expect(providerCalls).toEqual({ 'alpha-ai': 1, 'beta-ai': 1 });
  });
});
