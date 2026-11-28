import { describe, expect, it } from 'vitest';
import { runSelectorReview } from './selector-review';

describe('selector-driven review example', () => {
  it('loops author and reviewer until the reviewer approves, steered by the selector', async () => {
    const { result, speakers, transcript, decisions } = await runSelectorReview();
    expect(speakers).toEqual(['author', 'reviewer', 'author', 'reviewer']);
    expect(transcript).toEqual([
      'author: Draft 1: Fixed the parser.',
      'reviewer: CHANGES REQUESTED: say what was broken and how it is covered.',
      'author: Draft 2: Fixed the parser crash on empty input, with a regression test.',
      'reviewer: APPROVED',
    ]);
    // The selector's last decision finished the conversation, and its reason is the run's reason.
    expect(result).toMatchObject({ status: 'completed', reason: 'The reviewer approved.' });
    expect(
      decisions.map((decision) => [decision.participantIds?.[0] ?? 'finish', decision.reason]),
    ).toEqual([
      ['author', 'Nothing yet: draft.'],
      ['reviewer', 'A draft is ready to review.'],
      ['author', 'The reviewer asked for changes.'],
      ['reviewer', 'A draft is ready to review.'],
      ['finish', 'The reviewer approved.'],
    ]);
  });
});
