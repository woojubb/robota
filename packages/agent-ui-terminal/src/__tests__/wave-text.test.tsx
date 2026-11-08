/**
 * SCREEN-006 WaveText token-sourcing tests.
 *
 * WaveText's color ramp comes from the resolved theme's motion tokens (its cadence is its own) in
 * `src/theme/built-in-themes.ts` (not component-private literals), and the gated/static
 * frame must use the canonical muted token. Reduced-motion behavior is
 * re-asserted against the token source: when `isInteractiveColorTerminal()` is
 * false there is no interval and no color churn.
 */
import chalk from 'chalk';
import { render } from 'ink-testing-library';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import WaveText from '../WaveText.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';
import { DARK_THEME } from '../theme/built-in-themes.js';
import { foreground } from '../theme/index.js';

/** Cadence is not themed; the component owns it (SCREEN-2002). */
const WAVE_INTERVAL_MS = 400;

const gateMock = vi.hoisted(() => ({ value: true }));

vi.mock('../terminal-capabilities.js', () => ({
  isInteractiveColorTerminal: (): boolean => gateMock.value,
}));

/** Extract every SGR open-sequence used in a frame (e.g. "38;2;85;85;85"). */
function sgrCodes(frame: string): string[] {
  // eslint-disable-next-line no-control-regex -- asserting on raw SGR escape bytes by design
  return [...frame.matchAll(/\x1b\[([0-9;]+)m/g)].map((m) => m[1]);
}

/** The SGR open code chalk emits for a color, at the level ink uses in this env. */
function chalkOpenCodes(colorize: (s: string) => string): string[] {
  return sgrCodes(colorize('x'));
}

const ORIGINAL_CHALK_LEVEL = chalk.level;

beforeAll(() => {
  // Pin color bytes regardless of the test process's TTY detection (cjk-fallback precedent).
  chalk.level = 3;
});

afterAll(() => {
  chalk.level = ORIGINAL_CHALK_LEVEL;
});

afterEach(() => {
  gateMock.value = true;
  vi.useRealTimers();
});

describe('WaveText motion tokens (SCREEN-006)', () => {
  it('animated frames draw only from the theme’s wave ramp', () => {
    gateMock.value = true;
    const allowed = new Set<string>(['39', '0']);
    for (const stop of DARK_THEME.motion.wave) {
      for (const code of chalkOpenCodes((s) => chalk.hex(stop)(s))) {
        allowed.add(code);
      }
    }

    const { lastFrame, unmount } = render(<WaveText text="Thinking" />);
    const frame = lastFrame() ?? '';
    unmount();

    const used = sgrCodes(frame);
    expect(used.length).toBeGreaterThan(0);
    const outside = used.filter((code) => !allowed.has(code));
    expect(outside).toEqual([]);
  });

  it('gated/static frame renders with the theme’s muted token and no color churn', () => {
    gateMock.value = false;
    vi.useFakeTimers();

    const { lastFrame, unmount } = render(<WaveText text="Thinking" />);
    const first = lastFrame() ?? '';

    // The muted token (not a wave hex stop) styles the static frame.
    const mutedCodes = chalkOpenCodes((s) => foreground(DARK_THEME.colors.text.muted)(s));
    for (const code of mutedCodes) {
      expect(first).toContain(`\u001b[${code}m`);
    }

    // No interval ⇒ no motion: advancing time produces the identical frame.
    vi.advanceTimersByTime(WAVE_INTERVAL_MS * 5);
    const later = lastFrame() ?? '';
    unmount();
    expect(later).toBe(first);
  });
});

/**
 * CLI-2004 TC-19 — a spinner is a repaint per frame, and a repaint is an announcement. In the mode
 * the text is written once and no interval is ever scheduled.
 */
describe('CLI-2004 TC-19: WaveText in screen-reader mode', () => {
  it('renders its text once and schedules no interval', () => {
    gateMock.value = true; // the colour gate is OPEN — the mode alone must stop the animation
    vi.useFakeTimers();

    const { lastFrame, unmount } = render(
      <ScreenReaderProvider enabled={true}>
        <WaveText text="Thinking" />
      </ScreenReaderProvider>,
    );
    const first = lastFrame() ?? '';

    // No pending timer at all — not merely a frame that happens to look the same.
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(WAVE_INTERVAL_MS * 5);
    const later = lastFrame() ?? '';
    unmount();

    expect(first).toContain('Thinking');
    expect(later).toBe(first);
    expect(sgrCodes(first).filter((code) => code !== '0' && code !== '39')).toEqual([]);
  });

  it('leaves the 400 ms ramp exactly as it is outside the mode', () => {
    gateMock.value = true;
    vi.useFakeTimers();

    const { unmount } = render(<WaveText text="Thinking" />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
  });
});
