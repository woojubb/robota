/**
 * CLI-062 — pure flow for real-terminal-cursor positioning during CJK IME composition.
 *
 * Maps the input box's absolute frame-space origin plus the live (value, cursor) to the exact
 * screen cell the hardware cursor must occupy, and guards WHEN positioning is allowed at all.
 * Contract: .design/investigations/2026-07-25-cli-062-ime-cursor-design.md.
 *
 * The wrap math reuses `displayOffset` — the same wrap-aware column accounting the input's
 * vertical navigation already trusts — so the computed cell always matches where ink actually
 * rendered the character under the cursor.
 */

import { displayOffset } from './cjk-text-input-flow.js';

export interface ICursorCellInput {
  /** Absolute frame-space column of the input box's first cell. */
  absX: number;
  /** Absolute frame-space row of the input box's first line. */
  absY: number;
  /** Current input value. */
  value: string;
  /** Cursor as a character index into the value (clamped to the value length). */
  cursor: number;
  /** Wrap width in columns; unset/non-positive means the value renders unwrapped. */
  availableWidth?: number;
}

export interface ICursorCell {
  x: number;
  y: number;
}

export interface IRealCursorGuardInput {
  /** Whether the input box has been measured in the CURRENT yoga layout. */
  hasMeasured: boolean;
  /** Target cursor row (absolute frame space). */
  y: number;
  /** Height of the live frame (ink-root yoga height). */
  frameHeight: number;
  /** Terminal viewport rows. */
  viewportRows: number;
  /** Terminal capability + focus gate (supportsImeCursorPositioning() && focused && showCursor). */
  capability: boolean;
}

/** Compute the hardware-cursor cell for the current composition point. */
export function computeCursorCell(input: ICursorCellInput): ICursorCell {
  const chars = [...input.value];
  const cursor = Math.min(Math.max(input.cursor, 0), chars.length);
  const width =
    input.availableWidth !== undefined && input.availableWidth > 0
      ? input.availableWidth
      : undefined;
  const offset = displayOffset(chars, cursor, width ?? Number.MAX_SAFE_INTEGER);
  if (width === undefined) {
    return { x: input.absX + offset, y: input.absY };
  }
  return { x: input.absX + (offset % width), y: input.absY + Math.floor(offset / width) };
}

/**
 * Crash-avoidance guard — the SIGSEGV invariants from the CLI-062 contract:
 *
 * - I1: never a GUESSED row — position only with a y measured from the current yoga layout
 *   (`hasMeasured`); the historical hardcoded `y: 0` pointed the cursor at the logo area, where
 *   Terminal.app's Korean IME `attributedSubstringFromRange:` null-derefs (Apple-side bug).
 * - I2: never into an overflowing frame — when `frameHeight >= viewportRows` ink's bottom-anchor
 *   assumption breaks (upstream defect, present in ink 7.0.5 AND 7.1.1: the cursor lands one row
 *   high in the fullscreen path, and an overflowing frame clamps `cursorUp` at the screen top —
 *   the original crash geometry). Same for a y outside `[0, frameHeight)`.
 * - I5 lives in `supportsImeCursorPositioning()` and arrives here folded into `capability`.
 *
 * I3 (all movement rides ink's synchronized frame writes) and I4 (guard fail → no call → today's
 * rendering) are properties of the hook that consumes this guard (useRealCursorPosition).
 */
export function shouldPositionRealCursor(input: IRealCursorGuardInput): boolean {
  if (!input.capability) return false;
  if (!input.hasMeasured) return false; // I1
  if (input.viewportRows <= 0 || input.frameHeight <= 0) return false;
  if (input.frameHeight >= input.viewportRows) return false; // I2 (fullscreen / overflow)
  if (input.y < 0 || input.y >= input.frameHeight) return false; // I2 (out of frame)
  return true;
}
