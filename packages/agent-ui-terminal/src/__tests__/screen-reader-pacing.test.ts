/**
 * CLI-2004 TC-20 — the startup quiet period.
 *
 * The bound matters more than the default: a mistyped host timing override is
 * how a session appears to hang forever, and a silently-swallowed value is how it appears to have no
 * effect at all. Every rejection and every clamp is REPORTED, and this asserts the report.
 *
 * The last case is the one the review added: "any keypress ends the wait" is only true if something
 * puts a TTY stdin into raw mode first, because a canonical-mode terminal delivers nothing until
 * Enter. Asserting it against a synthetic source alone would have proved a behaviour the product
 * does not have.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  awaitStartupQuietPeriod,
  DEFAULT_PREPARK_MS,
  DEFAULT_STARTUP_QUIET_MS,
  PREPARK_MS_MAX,
  resolvePacing,
  STARTUP_QUIET_MS_MAX,
} from '../screen-reader-pacing.js';

const STARTUP_LABEL = 'ACME_SCREEN_READER_STARTUP_QUIET_MS';
const PREPARK_LABEL = 'ACME_SCREEN_READER_PREPARK_MS';

function startup(raw: string) {
  return { startupQuiet: { raw, label: STARTUP_LABEL } };
}

function prepark(raw: string) {
  return { prepark: { raw, label: PREPARK_LABEL } };
}

function collectWarnings(): { notes: string[]; warn: (message: string) => void } {
  const notes: string[] = [];
  return { notes, warn: (message: string): void => void notes.push(message) };
}

describe('TC-20: resolvePacing', () => {
  it('ignores ambient Robota pacing variables without a host choice', () => {
    vi.stubEnv('ROBOTA_SCREEN_READER_STARTUP_QUIET_MS', '0');
    vi.stubEnv('ROBOTA_SCREEN_READER_PREPARK_MS', '0');
    try {
      expect(resolvePacing({ enabled: true })).toEqual({
        startupQuietMs: DEFAULT_STARTUP_QUIET_MS,
        preparkMs: DEFAULT_PREPARK_MS,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('returns the documented default when the host supplies no override', () => {
    expect(resolvePacing({ enabled: true })).toEqual({
      startupQuietMs: DEFAULT_STARTUP_QUIET_MS,
      preparkMs: DEFAULT_PREPARK_MS,
    });
  });

  it('honours an explicit 0 exactly — the documented way to ask for no wait', () => {
    expect(resolvePacing({ enabled: true, overrides: startup('0') })).toEqual({
      startupQuietMs: 0,
      preparkMs: DEFAULT_PREPARK_MS,
    });
  });

  it('clamps the variable to its sanity bound AND reports the clamp', () => {
    const sink = collectWarnings();
    const pacing = resolvePacing({
      enabled: true,
      overrides: startup('999999'),
      warn: sink.warn,
    });

    expect(pacing).toEqual({ startupQuietMs: STARTUP_QUIET_MS_MAX, preparkMs: DEFAULT_PREPARK_MS });
    expect(sink.notes).toHaveLength(1);
    expect(sink.notes[0]).toContain(`clamping 999999 to the ${STARTUP_QUIET_MS_MAX} ms`);
  });

  it('refuses a non-numeric value with a note instead of silently treating it as 0', () => {
    const sink = collectWarnings();
    const pacing = resolvePacing({
      enabled: true,
      overrides: startup('soon'),
      warn: sink.warn,
    });

    expect(pacing.startupQuietMs).toBe(DEFAULT_STARTUP_QUIET_MS);
    expect(pacing.startupQuietMs).not.toBe(0);
    expect(sink.notes[0]).toContain('ignoring "soon"');
  });

  it('resolves the wait to 0 without warnings when the mode is off', () => {
    const sink = collectWarnings();
    expect(resolvePacing({
      enabled: false,
      overrides: startup('invalid'),
      warn: sink.warn,
    })).toEqual({
      startupQuietMs: 0,
      preparkMs: 0,
    });
    expect(sink.notes).toEqual([]);
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

  it('puts a TTY stdin into raw mode for the wait and restores it — without raw mode only Enter arrives', async () => {
    vi.useFakeTimers();
    try {
      const modes: boolean[] = [];
      let onData: (() => void) | undefined;
      const keys = {
        once: (_event: 'data', listener: () => void): void => void (onData = listener),
        off: (): void => {},
        resume: (): void => {},
        pause: (): void => {},
        isTTY: true,
        setRawMode: (mode: boolean): void => void modes.push(mode),
      };

      const settled = awaitStartupQuietPeriod(600_000, keys);
      expect(modes).toEqual([true]);
      onData?.();
      await expect(settled).resolves.toBe('keypress');
      expect(modes).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a non-TTY stdin alone — there is no raw mode to set on a pipe', async () => {
    vi.useFakeTimers();
    try {
      let touchedRawMode = false;
      const keys = {
        once: (): void => {},
        off: (): void => {},
        isTTY: false,
        setRawMode: (): void => void (touchedRawMode = true),
      };
      const settled = awaitStartupQuietPeriod(200, keys);
      await vi.advanceTimersByTimeAsync(200);
      await expect(settled).resolves.toBe('elapsed');
      expect(touchedRawMode).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SCREEN-2670 TC-01: resolvePacing returns preparkMs by the same discipline', () => {
  it('defaults to the provisional 50 and honours an explicit 0 exactly', () => {
    expect(resolvePacing({ enabled: true }).preparkMs).toBe(50);
    expect(resolvePacing({ enabled: true, overrides: prepark('0') }).preparkMs).toBe(0);
    expect(resolvePacing({ enabled: true, overrides: prepark('250') }).preparkMs).toBe(250);
  });

  it('refuses a non-numeric or negative value WITH a note naming the variable', () => {
    for (const raw of ['soon', '-5', '1.5']) {
      const sink = collectWarnings();
      const pacing = resolvePacing({ enabled: true, overrides: prepark(raw), warn: sink.warn });
      expect(pacing.preparkMs).toBe(DEFAULT_PREPARK_MS);
      expect(sink.notes).toHaveLength(1);
      expect(sink.notes[0]).toContain(PREPARK_LABEL);
      expect(sink.notes[0]).toContain(`"${raw}"`);
    }
  });

  it('clamps above the bound AND reports the clamp', () => {
    const sink = collectWarnings();
    const pacing = resolvePacing({
      enabled: true,
      overrides: prepark('99999'),
      warn: sink.warn,
    });
    expect(pacing.preparkMs).toBe(PREPARK_MS_MAX);
    expect(sink.notes[0]).toContain(`clamping 99999 to the ${PREPARK_MS_MAX} ms`);
  });

  it('is 0 whenever the mode is off, regardless of the variable', () => {
    expect(resolvePacing({ enabled: false, overrides: prepark('250') })).toEqual({
      startupQuietMs: 0,
      preparkMs: 0,
    });
  });
});
