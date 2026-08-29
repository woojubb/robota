import { describe, expect, it } from 'vitest';

import { measurePullRequests, readPullRequest } from '../record-pr-lifecycle-measurement.mjs';

describe('record-pr-lifecycle-measurement', () => {
  it('exports testable measurement boundaries', () => {
    expect(readPullRequest).toBeTypeOf('function');
    expect(measurePullRequests).toBeTypeOf('function');
  });
});
