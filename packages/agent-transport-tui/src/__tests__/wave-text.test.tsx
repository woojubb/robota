/**
 * SCREEN-006 WaveText token-sourcing tests.
 *
 * WaveText's color ramp and cadence must come from the MOTION tokens in
 * `src/tui-palette.ts` (not component-private literals), and the gated/static
 * frame must use the canonical muted token. Reduced-motion behavior is
 * re-asserted against the token source: when `isInteractiveColorTerminal()` is
 * false there is no interval and no color churn.
 */
import chalk from 'chalk';
import { render } from 'ink-testing-library';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import WaveText from '../WaveText.js';
import { MOTION, PALETTE } from '../tui-palette.js';

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
  it('animated frames draw only from MOTION.waveColors', () => {
    gateMock.value = true;
    const allowed = new Set<string>(['39', '0']);
    for (const stop of MOTION.waveColors) {
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

  it('gated/static frame renders with PALETTE.text.muted and no color churn', () => {
    gateMock.value = false;
    vi.useFakeTimers();

    const { lastFrame, unmount } = render(<WaveText text="Thinking" />);
    const first = lastFrame() ?? '';

    // The muted token (not a wave hex stop) styles the static frame.
    const mutedCodes = chalkOpenCodes((s) => {
      const colorize = (chalk as unknown as Record<string, (v: string) => string>)[
        PALETTE.text.muted
      ];
      return colorize ? colorize(s) : chalk.hex(PALETTE.text.muted)(s);
    });
    for (const code of mutedCodes) {
      expect(first).toContain(`\u001b[${code}m`);
    }

    // No interval ⇒ no motion: advancing time produces the identical frame.
    vi.advanceTimersByTime(MOTION.waveIntervalMs * 5);
    const later = lastFrame() ?? '';
    unmount();
    expect(later).toBe(first);
  });
});
