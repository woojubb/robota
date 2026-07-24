/**
 * SCREEN-006 unit tests for the shared TUI semantic palette + motion tokens.
 *
 * - Every `PALETTE` leaf must be a valid Ink/chalk color name (explicit allowlist) or a
 *   `#rrggbb` hex value — mechanics only, no free-form strings.
 * - `MOTION` must keep its contract shape (4-stop wave ramp, positive cadence).
 * - `STATUS_GLYPH` must source its colors from `PALETTE.status` for all 7 kinds (the
 *   one-way flow `status-glyph` → `tui-palette`).
 */
import { describe, expect, it } from 'vitest';

import { STATUS_GLYPH, type TUiStatusKind } from '../status-glyph.js';
import { MOTION, PALETTE } from '../tui-palette.js';

/** Ink/chalk foreground color names the palette is allowed to use. */
const INK_COLOR_ALLOWLIST = new Set([
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'grey',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
]);

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isValidColorValue(value: string): boolean {
  return INK_COLOR_ALLOWLIST.has(value) || HEX_PATTERN.test(value);
}

describe('PALETTE tokens', () => {
  it('every leaf is a valid Ink color name or #rrggbb hex', () => {
    const invalid: string[] = [];
    for (const [groupName, group] of Object.entries(PALETTE)) {
      for (const [tokenName, value] of Object.entries(group)) {
        if (!isValidColorValue(value)) {
          invalid.push(`PALETTE.${groupName}.${tokenName} = ${JSON.stringify(value)}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it('exposes the three semantic groups (text/border/status)', () => {
    expect(Object.keys(PALETTE).sort()).toEqual(['border', 'status', 'text']);
  });
});

describe('MOTION tokens', () => {
  it('wave ramp is a 4-stop hex ramp', () => {
    expect(MOTION.waveColors).toHaveLength(4);
    for (const stop of MOTION.waveColors) {
      expect(stop).toMatch(HEX_PATTERN);
    }
  });

  it('wave cadence and grouping are positive', () => {
    expect(MOTION.waveIntervalMs).toBeGreaterThan(0);
    expect(MOTION.waveCharsPerGroup).toBeGreaterThan(0);
  });
});

describe('STATUS_GLYPH sources colors from PALETTE.status', () => {
  const KINDS: readonly TUiStatusKind[] = [
    'running',
    'success',
    'error',
    'denied',
    'waiting',
    'cancelled',
    'idle',
  ];

  it('covers all 7 status kinds', () => {
    expect(Object.keys(PALETTE.status).sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)('STATUS_GLYPH.%s.color === PALETTE.status.%s', (kind) => {
    expect(STATUS_GLYPH[kind].color).toBe(PALETTE.status[kind]);
  });
});
