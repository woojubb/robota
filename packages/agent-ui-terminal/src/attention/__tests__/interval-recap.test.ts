import { describe, expect, it } from 'vitest';

import { IntervalRecap, RECAP_MAX_WIDTH } from '../interval-recap.js';

describe('IntervalRecap (SCREEN-1992 TC-02)', () => {
  it('counts turns by source, needs-input requests and terminal entries, and yields one line on return', () => {
    const recap = new IntervalRecap();
    // Attended: nothing is counted.
    recap.turnSource('user');
    recap.turnCompleted();
    expect(recap.onReturned('2026-01-01T00:00:00.000Z')).toBeUndefined();

    // Already terminal before the interval: old news, never counted.
    recap.entryState('task:old', 'completed');
    recap.onLost('2026-01-01T00:00:00.000Z');
    recap.entryState('task:old', 'completed');
    recap.turnSource('agent-wakeup');
    recap.turnCompleted();
    recap.turnSource('user');
    recap.turnCompleted();
    recap.needsInput();
    recap.entryState('task:1', 'working');
    recap.entryState('task:1', 'failed');
    recap.entryState('task:1', 'failed'); // same terminal state twice counts once
    recap.entryState('task:2', 'completed');
    recap.entryState('task:3', 'completed');
    recap.entryState('task:3', 'working'); // left the terminal state again: dropped
    recap.error();
    const line = recap.onReturned('2026-01-01T00:12:00.000Z');
    expect(line).toBe(
      'While away 12m: 2 turns finished (1 wake) · 1 needs input · 1 completed · 1 failed · 1 error',
    );
    // A second return without a new interval yields nothing.
    expect(recap.onReturned('2026-01-01T00:13:00.000Z')).toBeUndefined();
  });

  it('yields nothing for an empty interval and bounds a long line', () => {
    const recap = new IntervalRecap();
    recap.onLost('2026-01-01T00:00:00.000Z');
    expect(recap.onReturned('2026-01-01T01:00:00.000Z')).toBeUndefined();

    recap.onLost('2026-01-01T02:00:00.000Z');
    for (let i = 0; i < 1000; i += 1) recap.entryState(`task:${i}`, 'completed');
    const line = recap.onReturned('2026-01-01T03:30:00.000Z')!;
    expect(line.length).toBeLessThanOrEqual(RECAP_MAX_WIDTH);
    expect(line).toContain('While away 1h 30m');
  });
});
