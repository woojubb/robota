/**
 * SCREEN-009: lock in the status-legibility invariant — every status kind pairs a non-empty
 * SYMBOL with a color (never color alone), so the TUI stays legible on no-color terminals and
 * for colorblind users. A new status kind that omits the symbol fails here.
 */
import { describe, it, expect } from 'vitest';
import { STATUS_SYMBOL, statusGlyphColor, workspaceStatusKind } from '../status-glyph';

import type { TUiStatusKind } from '../status-glyph';
import { DARK_THEME } from '../theme/built-in-themes.js';

describe('status-glyph SSOT (SCREEN-009)', () => {
  it('every status kind has a non-empty symbol AND color (no color-only state)', () => {
    const entries = Object.entries(STATUS_SYMBOL) as [TUiStatusKind, string][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [kind, symbol] of entries) {
      expect(symbol, `${kind} must have a symbol`).toBeTruthy();
      expect(symbol.length, `${kind} symbol must be non-empty`).toBeGreaterThan(0);
      // SCREEN-2002: the colour comes from the live theme, so the pairing is checked against one.
      expect(statusGlyphColor(DARK_THEME.colors, kind), `${kind} must have a color`).toBeTruthy();
    }
  });

  it('workspaceStatusKind maps to a glyph that exists in the SSOT', () => {
    const kind = workspaceStatusKind('completed');
    expect(kind).toBe('success');
    expect(STATUS_SYMBOL[kind]).toBeTruthy();
    expect(statusGlyphColor(DARK_THEME.colors, kind)).toBeTruthy();
  });
});
