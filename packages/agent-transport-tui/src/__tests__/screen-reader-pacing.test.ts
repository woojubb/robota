/**
 * CLI-2004 TC-20 — the two pacing waits.
 *
 * The bounds matter more than the defaults: a mistyped `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` is
 * how a session appears to hang forever, and a silently-swallowed value is how it appears to have no
 * effect at all. Every rejection and every clamp is REPORTED, and this asserts the report.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  awaitStartupQuietPeriod,
  COLUMN_ZERO,
  DEFAULT_PREPARK_MS,
  DEFAULT_STARTUP_QUIET_MS,
  parkThenWrite,
  PREPARK_ENV,
  PREPARK_MS_MAX,
  resolvePacing,
  STARTUP_QUIET_ENV,
  STARTUP_QUIET_MS_MAX,
} from '../screen-reader-pacing.js';

function collectWarnings(): { notes: string[]; warn: (message: string) => void } {
  const notes: string[] = [];
  return { notes, warn: (message: string): void => void notes.push(message) };
}

describe('TC-20: resolvePacing', () => {
  it('returns the documented defaults when neither variable is set', () => {
    expect(resolvePacing({ enabled: true, env: {} })).toEqual({
      startupQuietMs: DEFAULT_STARTUP_QUIET_MS,
      preparkMs: DEFAULT_PREPARK_MS,
    });
  });

  it('honours an explicit 0 exactly — the documented way to ask for no wait', () => {
    const pacing = resolvePacing({
      enabled: true,
      env: { [STARTUP_QUIET_ENV]: '0', [PREPARK_ENV]: '0' },
    });
    expect(pacing).toEqual({ startupQuietMs: 0, preparkMs: 0 });
  });

  it('clamps both variables to their sanity bounds AND reports each clamp', () => {
    const sink = collectWarnings();
    const pacing = resolvePacing({
      enabled: true,
      env: { [STARTUP_QUIET_ENV]: '999999', [PREPARK_ENV]: '99999' },
      warn: sink.warn,
    });

    expect(pacing).toEqual({
      startupQuietMs: STARTUP_QUIET_MS_MAX,
      preparkMs: PREPARK_MS_MAX,
    });
    expect(sink.notes).toHaveLength(2);
    expect(sink.notes[0]).toContain(`clamping 999999 to the ${STARTUP_QUIET_MS_MAX} ms`);
    expect(sink.notes[1]).toContain(`clamping 99999 to the ${PREPARK_MS_MAX} ms`);
  });

  it('refuses a non-numeric value with a note instead of silently treating it as 0', () => {
    const sink = collectWarnings();
    const pacing = resolvePacing({
      enabled: true,
      env: { [STARTUP_QUIET_ENV]: 'soon' },
      warn: sink.warn,
    });

    expect(pacing.startupQuietMs).toBe(DEFAULT_STARTUP_QUIET_MS);
    expect(pacing.startupQuietMs).not.toBe(0);
    expect(sink.notes[0]).toContain('ignoring "soon"');
  });

  it('resolves both waits to 0 when the mode is off, whatever the variables say', () => {
    expect(
      resolvePacing({
        enabled: false,
        env: { [STARTUP_QUIET_ENV]: '5000', [PREPARK_ENV]: '500' },
      }),
    ).toEqual({ startupQuietMs: 0, preparkMs: 0 });
  });
});

describe('TC-20: the startup quiet period', () => {
  it('settles at its deadline when nothing is pressed', async () => {
    vi.useFakeTimers();
    try {
      const settled = awaitStartupQuietPeriod(500);
      await vi.advanceTimersByTimeAsync(500);
      await expect(settled).resolves.toBe('elapsed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a keypress settles it BEFORE its deadline', async () => {
    vi.useFakeTimers();
    try {
      let onData: (() => void) | undefined;
      const keys = {
        once: (_event: 'data', listener: () => void): void => void (onData = listener),
        off: (): void => {},
        resume: (): void => {},
        pause: (): void => {},
      };
      const settled = awaitStartupQuietPeriod(600_000, keys);
      await vi.advanceTimersByTimeAsync(10);
      onData?.();
      await expect(settled).resolves.toBe('keypress');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves immediately for a 0 wait without touching the keypress source', async () => {
    let touched = false;
    await expect(
      awaitStartupQuietPeriod(0, {
        once: (): void => void (touched = true),
        off: (): void => {},
      }),
    ).resolves.toBe('elapsed');
    expect(touched).toBe(false);
  });
});

describe('TC-20: the pre-write park', () => {
  it('emits a column-0 move BEFORE the waited write', async () => {
    const written: string[] = [];
    await parkThenWrite(0, 'assistant: hello', (chunk) => void written.push(chunk));
    expect(written).toEqual([COLUMN_ZERO, 'assistant: hello']);
  });

  it('waits between the park and the write when a park is configured', async () => {
    vi.useFakeTimers();
    try {
      const written: string[] = [];
      const done = parkThenWrite(DEFAULT_PREPARK_MS, 'line', (chunk) => void written.push(chunk));
      expect(written).toEqual([COLUMN_ZERO]);
      await vi.advanceTimersByTimeAsync(DEFAULT_PREPARK_MS);
      await done;
      expect(written).toEqual([COLUMN_ZERO, 'line']);
    } finally {
      vi.useRealTimers();
    }
  });
});
