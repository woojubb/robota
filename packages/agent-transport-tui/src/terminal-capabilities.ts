/**
 * Single source of truth for "should this process emit color + motion to the
 * terminal?" — used by both the markdown renderer (color) and WaveText (motion),
 * so the two never disagree (SCREEN-008).
 *
 * Precedence:
 *  - `NO_COLOR` present (any value, including empty) → off (per the NO_COLOR convention).
 *  - `FORCE_COLOR=0` → off; `FORCE_COLOR=<non-empty, non-0>` → on.
 *  - otherwise → on only when stdout is an interactive TTY.
 */
export function isInteractiveColorTerminal(): boolean {
  if ('NO_COLOR' in process.env) return false;
  const force = process.env.FORCE_COLOR;
  if (force === '0') return false;
  if (force !== undefined && force !== '') return true;
  return Boolean(process.stdout.isTTY);
}
