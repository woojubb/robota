import { describe, expect, it, vi } from 'vitest';

import { AttentionTracker, DEFAULT_IDLE_THRESHOLD_MS } from '../attention-tracker.js';

function tracker(options: { focusReporting: boolean }) {
  const events: string[] = [];
  const instance = new AttentionTracker({
    focusReporting: options.focusReporting,
    now: () => Date.now(),
  });
  instance.subscribe((change) => events.push(`${change.kind}@${change.at}`));
  return { instance, events };
}

describe('AttentionTracker (SCREEN-1992 TC-01)', () => {
  it('with focus reporting, focus-out and focus-in emit once per transition and the idle source is inert', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const { instance, events } = tracker({ focusReporting: true });
      instance.start();
      expect(instance.attended).toBe(true);
      // Requested is not confirmed: until a focus event arrives the idle source decides.
      expect(instance.source).toBe('idle');
      instance.focusOut();
      expect(instance.source).toBe('focus');
      instance.focusOut();
      expect(instance.attended).toBe(false);
      expect(events).toEqual(['lost@2026-01-01T00:00:00.000Z']);
      vi.advanceTimersByTime(DEFAULT_IDLE_THRESHOLD_MS * 3);
      instance.keystroke(); // a keystroke while focus reporting is authoritative changes nothing
      expect(instance.attended).toBe(false);
      vi.setSystemTime(new Date('2026-01-01T00:20:00.000Z'));
      instance.focusIn();
      instance.focusIn();
      expect(events).toEqual([
        'lost@2026-01-01T00:00:00.000Z',
        'returned@2026-01-01T00:20:00.000Z',
      ]);
      instance.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('with focus reporting requested but never answered, the idle source still runs', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const { instance, events } = tracker({ focusReporting: true });
      instance.start();
      vi.advanceTimersByTime(DEFAULT_IDLE_THRESHOLD_MS);
      expect(instance.attended).toBe(false);
      expect(instance.source).toBe('idle');
      instance.keystroke();
      expect(instance.attended).toBe(true);
      expect(events.map((event) => event.split('@')[0])).toEqual(['lost', 'returned']);
      // The first focus event disarms the idle source for good.
      instance.focusIn();
      vi.advanceTimersByTime(DEFAULT_IDLE_THRESHOLD_MS * 2);
      expect(instance.attended).toBe(true);
      expect(instance.source).toBe('focus');
      instance.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a focus event when focus reporting is off', () => {
    const { instance } = tracker({ focusReporting: false });
    expect(() => instance.focusIn()).toThrow(/focus reporting is off/u);
  });

  it('without focus reporting, the idle threshold marks unattended and the next keystroke marks attended', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const { instance, events } = tracker({ focusReporting: false });
      expect(instance.source).toBe('idle');
      instance.start();
      vi.advanceTimersByTime(DEFAULT_IDLE_THRESHOLD_MS - 1);
      instance.keystroke(); // activity resets the idle clock
      vi.advanceTimersByTime(DEFAULT_IDLE_THRESHOLD_MS - 1);
      expect(instance.attended).toBe(true);
      expect(events).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(instance.attended).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatch(/^lost@/);
      instance.keystroke();
      expect(instance.attended).toBe(true);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatch(/^returned@/);
      instance.keystroke();
      expect(events).toHaveLength(2);
      instance.dispose();
      vi.advanceTimersByTime(DEFAULT_IDLE_THRESHOLD_MS * 2);
      expect(events).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
