/**
 * SCREEN-2002 TC-01/TC-05 — the built-in themes as data, and the pairing the palette floor guards.
 *
 * Succeeds the SCREEN-006 `tui-palette.test.ts`: the same mechanics (every leaf is a colour in the
 * grammar, the wave ramp is four stops, status covers the seven kinds), now over four themes instead
 * of one map, plus the pairing `status-glyph` used to hold as a constant — a symbol for every kind a
 * theme colours, so a status is never colour alone.
 */
import { describe, expect, it } from 'vitest';

import { BUILT_IN_THEMES, DARK_THEME } from '../built-in-themes.js';
import { isThemeColor } from '../theme-styles.js';
import { STATUS_SYMBOL, statusGlyphColor, type TUiStatusKind } from '../../status-glyph.js';

import type { ITuiTheme } from '../theme-contracts.js';

const KINDS: readonly TUiStatusKind[] = [
  'running',
  'success',
  'error',
  'denied',
  'waiting',
  'cancelled',
  'idle',
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/u;

function leaves(theme: ITuiTheme): [string, string][] {
  const entries: [string, string][] = [];
  for (const [group, values] of Object.entries(theme.colors)) {
    for (const [token, value] of Object.entries(values)) {
      entries.push([`colors.${group}.${token}`, value as string]);
    }
  }
  for (const [token, value] of Object.entries(theme.markdown))
    entries.push([`markdown.${token}`, value]);
  for (const [token, value] of Object.entries(theme.syntax))
    entries.push([`syntax.${token}`, value]);
  theme.motion.wave.forEach((value, index) => entries.push([`motion.wave[${index}]`, value]));
  return entries;
}

describe('built-in themes (SCREEN-2002 TC-01)', () => {
  it.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))(
    '%s: every leaf is a colour in Ink’s grammar',
    (_id, theme) => {
      const invalid = leaves(theme).filter(([, value]) => !isThemeColor(value));
      expect(invalid).toEqual([]);
    },
  );

  it.each(BUILT_IN_THEMES.map((theme) => [theme.id, theme] as const))(
    '%s: the wave ramp is four stops and status covers the seven kinds',
    (_id, theme) => {
      expect(theme.motion.wave).toHaveLength(4);
      expect(Object.keys(theme.colors.status).sort()).toEqual([...KINDS].sort());
    },
  );

  it('ships one dark and one light variant of each family, with unique ids', () => {
    const ids = BUILT_IN_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['dark', 'light', 'dark-daltonized', 'light-daltonized']);
    expect(BUILT_IN_THEMES.filter((theme) => theme.appearance === 'light')).toHaveLength(2);
    expect(BUILT_IN_THEMES.every((theme) => theme.source === 'built-in')).toBe(true);
  });

  it('specifies the daltonized pair in hex so the CVD guard can simulate it', () => {
    for (const theme of BUILT_IN_THEMES.filter((candidate) =>
      candidate.id.endsWith('daltonized'),
    )) {
      const named = leaves(theme).filter(([, value]) => !HEX_PATTERN.test(value));
      expect(named).toEqual([]);
    }
  });
});

describe('status is never colour alone (SCREEN-2002 TC-05)', () => {
  it.each(KINDS)('%s has a symbol and a colour in every theme', (kind) => {
    expect(STATUS_SYMBOL[kind].length).toBeGreaterThan(0);
    for (const theme of BUILT_IN_THEMES) {
      expect(isThemeColor(statusGlyphColor(theme.colors, kind))).toBe(true);
    }
  });

  it('keeps the dark theme’s status colours identical to the values the package shipped', () => {
    expect(DARK_THEME.colors.status).toEqual({
      running: 'yellow',
      success: 'green',
      error: 'red',
      denied: 'yellowBright',
      waiting: 'yellow',
      cancelled: 'yellow',
      idle: 'gray',
    });
  });
});
