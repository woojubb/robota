import { describe, it, expect } from 'vitest';
import { parsePermissionMode, parseMaxTurns } from '../cli-args.js';

describe('parsePermissionMode', () => {
  it('returns undefined for undefined input', () => {
    expect(parsePermissionMode(undefined)).toBeUndefined();
  });

  it('returns valid modes', () => {
    expect(parsePermissionMode('plan')).toBe('plan');
    expect(parsePermissionMode('default')).toBe('default');
    expect(parsePermissionMode('acceptEdits')).toBe('acceptEdits');
    expect(parsePermissionMode('bypassPermissions')).toBe('bypassPermissions');
  });
});

describe('parseMaxTurns', () => {
  it('returns undefined for undefined input', () => {
    expect(parseMaxTurns(undefined)).toBeUndefined();
  });

  it('parses valid positive integer', () => {
    expect(parseMaxTurns('5')).toBe(5);
    expect(parseMaxTurns('100')).toBe(100);
  });

  it('parses string with leading zeros', () => {
    expect(parseMaxTurns('05')).toBe(5);
  });
});
