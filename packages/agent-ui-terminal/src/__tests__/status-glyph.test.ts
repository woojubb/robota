/**
 * SCREEN-009: lock in the status-legibility invariant — every status kind pairs a non-empty
 * SYMBOL with a color (never color alone), so the TUI stays legible on no-color terminals and
 * for colorblind users. A new status kind that omits the symbol fails here.
 */
import { describe, it, expect } from 'vitest';
import { STATUS_GLYPH, workspaceStatusKind } from '../status-glyph';

describe('status-glyph SSOT (SCREEN-009)', () => {
  it('every status kind has a non-empty symbol AND color (no color-only state)', () => {
    const entries = Object.entries(STATUS_GLYPH);
    expect(entries.length).toBeGreaterThan(0);
    for (const [kind, glyph] of entries) {
      expect(glyph.symbol, `${kind} must have a symbol`).toBeTruthy();
      expect(glyph.symbol.length, `${kind} symbol must be non-empty`).toBeGreaterThan(0);
      expect(glyph.color, `${kind} must have a color`).toBeTruthy();
    }
  });

  it('workspaceStatusKind maps to a glyph that exists in the SSOT', () => {
    const kind = workspaceStatusKind('completed');
    expect(kind).toBe('success');
    expect(STATUS_GLYPH[kind]).toBeDefined();
    expect(STATUS_GLYPH[kind].symbol).toBeTruthy();
  });
});
