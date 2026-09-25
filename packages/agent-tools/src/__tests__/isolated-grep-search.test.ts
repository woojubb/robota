import { expect, it } from 'vitest';

import { IsolatedGrepSearch } from '../builtins/isolated-grep-search.js';

it('rejects aggregate output before returning a later large match', async () => {
  const search = new IsolatedGrepSearch('x');
  try {
    const content = 'x'.repeat(1_100_000);
    for (let index = 0; index < 3; index++) {
      const matches = await search.search(content, `match-${index}.txt`, 0, 'content');
      expect(matches).toHaveLength(1);
    }
    const outcome = await search.search(content, 'match-4.txt', 0, 'content').then(
      () => 'unexpected success',
      (error: unknown) => error instanceof Error ? error.message : String(error),
    );
    expect(outcome).toBe('Grep search exceeded its byte limit');
  } finally {
    await search.stop();
  }
});
