import { describe, expect, it } from 'vitest';

import { formatCountdown } from '../countdown.js';

describe('formatCountdown (SCREEN-1992 TC-04)', () => {
  it('renders seconds, minutes and hours against the given now, and "now" once due', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(formatCountdown('2026-01-01T00:00:59.000Z', now)).toBe('in 59s');
    expect(formatCountdown('2026-01-01T00:04:59.000Z', now)).toBe('in 4m 59s');
    expect(formatCountdown('2026-01-01T02:05:00.000Z', now)).toBe('in 2h 5m');
    expect(formatCountdown('2026-01-01T00:00:00.000Z', now)).toBe('now');
    expect(formatCountdown('2025-12-31T23:59:00.000Z', now)).toBe('now');
    expect(formatCountdown('not-a-date', now)).toBeUndefined();
  });
});
