import { describe, expect, it } from 'vitest';
import { runAiOnlyStart } from './ai-only-start';

describe('AI-only start example', () => {
  it('opens with an agent turn and never waits for a person', async () => {
    const { result, transcript, seen } = await runAiOnlyStart();
    expect(result).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(transcript).toEqual([
      'planner: Proposal for "Plan the next release": ship the parser first, then the formatter.',
      'critic: Question: how do we test "Proposal for "Plan the next release": ship the parser first, then the formatter."?',
      'planner: Agreed, parser first.',
    ]);
    // The first speaker saw an empty transcript and only the purpose.
    expect(seen[0]).toBe('planner saw 0 message(s), purpose: Plan the next release');
  });
});
