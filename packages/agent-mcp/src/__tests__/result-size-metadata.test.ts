import { describe, expect, it } from 'vitest';

import { parseMCPResultSizeMetadata } from '../catalog/result-size-metadata.js';

describe('MCP result-size metadata', () => {
  it('projects a bounded upward character limit from tool metadata', () => {
    expect(parseMCPResultSizeMetadata({ 'anthropic/maxResultSizeChars': 40_000 })).toEqual({
      kind: 'accepted',
      maxResultChars: 40_000,
    });
  });

  it('never widens for malformed, fractional, or excessive metadata', () => {
    expect(parseMCPResultSizeMetadata(undefined)).toEqual({ kind: 'absent' });
    expect(parseMCPResultSizeMetadata({ unrelated: 'secret' })).toEqual({ kind: 'absent' });
    for (const value of ['500000', NaN, Infinity, 40_000.5, null]) {
      expect(parseMCPResultSizeMetadata({ 'anthropic/maxResultSizeChars': value })).toEqual({
        kind: 'invalid',
        reason: 'invalid-type',
      });
    }
    for (const value of [25_000, 500_001, -1]) {
      expect(parseMCPResultSizeMetadata({ 'anthropic/maxResultSizeChars': value })).toEqual({
        kind: 'invalid',
        reason: 'out-of-range',
      });
    }
  });
});
