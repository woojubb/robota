import { describe, expect, it } from 'vitest';

import { leakedIn } from './secret-leak.js';

describe('secret leak matching', () => {
  it('finds a phrase fragment only as a complete sequence', () => {
    expect(leakedIn('The operator typed SING CAT.', ['sing cat'])).toEqual(['sing cat']);
    expect(leakedIn('The record has a missing category.', ['sing cat'])).toEqual([]);
  });
});
