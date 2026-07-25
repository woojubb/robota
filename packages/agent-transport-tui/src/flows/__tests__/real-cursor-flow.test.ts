/**
 * CLI-062 — unit tables for the real-cursor pure flow.
 *
 * `computeCursorCell` maps (absolute input origin, value, cursor index, wrap width) to the
 * hardware-cursor cell, reusing the wrap-aware `displayOffset` math the input's vertical
 * navigation already trusts. `shouldPositionRealCursor` is the crash-avoidance guard: every
 * `false` row below is a SIGSEGV-invariant case (the historical Terminal.app crash geometry —
 * see .design/investigations/2026-07-25-cli-062-ime-cursor-design.md, invariants I1/I2/I5).
 */

import { describe, expect, it } from 'vitest';

import { computeCursorCell, shouldPositionRealCursor } from '../real-cursor-flow.js';

describe('computeCursorCell', () => {
  const origin = { absX: 3, absY: 2 };

  it('ASCII value, cursor at end, no wrap width', () => {
    expect(computeCursorCell({ ...origin, value: 'hello', cursor: 5 })).toEqual({ x: 8, y: 2 });
  });

  it('ASCII value, cursor at start', () => {
    expect(computeCursorCell({ ...origin, value: 'hello', cursor: 0 })).toEqual({ x: 3, y: 2 });
  });

  it('CJK wide chars count 2 columns each (안녕 → 4 columns)', () => {
    expect(computeCursorCell({ ...origin, value: '안녕', cursor: 2, availableWidth: 20 })).toEqual({
      x: 7,
      y: 2,
    });
  });

  it('mid-string cursor inside a CJK value', () => {
    expect(
      computeCursorCell({ ...origin, value: '안녕하세요', cursor: 2, availableWidth: 20 }),
    ).toEqual({ x: 7, y: 2 });
  });

  it('no wrap width: CJK offset is the plain display-width sum', () => {
    expect(computeCursorCell({ ...origin, value: '안녕하', cursor: 3 })).toEqual({ x: 9, y: 2 });
  });

  it('wraps to the next row when the offset passes the width', () => {
    expect(
      computeCursorCell({ ...origin, value: 'a'.repeat(12), cursor: 12, availableWidth: 10 }),
    ).toEqual({ x: 5, y: 3 });
  });

  it('exact-width boundary lands on column 0 of the next row', () => {
    expect(
      computeCursorCell({ ...origin, value: 'a'.repeat(12), cursor: 10, availableWidth: 10 }),
    ).toEqual({ x: 3, y: 3 });
  });

  it('wide char straddling the wrap boundary is pushed to the next row (display gap preserved)', () => {
    // 9 ASCII cols + a wide char that cannot fit in the last column: displayOffset skips the
    // dead column (9 → 10) then adds the wide char (→ 12) — cursor lands at row+1, col 2.
    expect(
      computeCursorCell({ ...origin, value: 'aaaaaaaaa안', cursor: 10, availableWidth: 10 }),
    ).toEqual({ x: 5, y: 3 });
  });

  it('empty value (placeholder case) → the origin cell', () => {
    expect(computeCursorCell({ ...origin, value: '', cursor: 0, availableWidth: 20 })).toEqual({
      x: 3,
      y: 2,
    });
  });

  it('cursor index beyond the value length clamps to the end', () => {
    expect(computeCursorCell({ ...origin, value: 'ab', cursor: 99 })).toEqual({ x: 5, y: 2 });
  });

  it('non-positive availableWidth behaves as unwrapped', () => {
    expect(computeCursorCell({ ...origin, value: 'hello', cursor: 5, availableWidth: 0 })).toEqual({
      x: 8,
      y: 2,
    });
  });
});

describe('shouldPositionRealCursor (every false row is a SIGSEGV-invariant case)', () => {
  const ok = { hasMeasured: true, y: 3, frameHeight: 8, viewportRows: 24, capability: true };

  it('positions when measured, in-bounds, frame smaller than viewport, capability on', () => {
    expect(shouldPositionRealCursor(ok)).toBe(true);
  });

  it('measured y === 0 is valid (only a GUESSED y:0 is the bug class, not a measured one)', () => {
    expect(shouldPositionRealCursor({ ...ok, y: 0 })).toBe(true);
  });

  it('I5/gate: capability off → never position', () => {
    expect(shouldPositionRealCursor({ ...ok, capability: false })).toBe(false);
  });

  it('I1: no measurement yet → never position (the historical hardcoded y:0 class)', () => {
    expect(shouldPositionRealCursor({ ...ok, hasMeasured: false })).toBe(false);
  });

  it('I2: frame fills the viewport (ink fullscreen path, off-by-one) → never position', () => {
    expect(shouldPositionRealCursor({ ...ok, frameHeight: 24 })).toBe(false);
  });

  it('I2: frame overflows the viewport (cursorUp clamps at screen top — crash geometry) → never', () => {
    expect(shouldPositionRealCursor({ ...ok, frameHeight: 30 })).toBe(false);
  });

  it('I2: y below the frame → never position', () => {
    expect(shouldPositionRealCursor({ ...ok, y: 8 })).toBe(false);
  });

  it('I2: negative y → never position', () => {
    expect(shouldPositionRealCursor({ ...ok, y: -1 })).toBe(false);
  });

  it('degenerate viewport (0 rows) → never position', () => {
    expect(shouldPositionRealCursor({ ...ok, viewportRows: 0 })).toBe(false);
  });

  it('degenerate frame (0 height) → never position', () => {
    expect(shouldPositionRealCursor({ ...ok, frameHeight: 0 })).toBe(false);
  });
});
