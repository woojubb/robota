import { describe, expect, it } from 'vitest';

import { isSafeSessionId } from '../../index.js';

describe('session id framework facade', () => {
  it('exposes the canonical single-path-component guard through the SDK boundary', () => {
    expect(isSafeSessionId('session_1781000002000_bbb')).toBe(true);
    expect(isSafeSessionId('../outside')).toBe(false);
    expect(isSafeSessionId('C:\\outside')).toBe(false);
  });
});
