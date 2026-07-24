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

/**
 * CLI-062 — may this process position the REAL terminal cursor for IME composition?
 *
 * Precedence:
 *  - `ROBOTA_IME_CURSOR=1` → on (explicit opt-in — the only way to enable it in Terminal.app).
 *  - `ROBOTA_IME_CURSOR=0` → off (kill switch).
 *  - `TERM_PROGRAM=Apple_Terminal` → off by default (invariant I5): the historical Korean-IME
 *    SIGSEGV is an Apple-side `attributedSubstringFromRange:` bug; its trigger geometry is gone
 *    (measured y + post-<Static> tiny frame), but Terminal.app stays opt-in until the manual
 *    matrix passes on real hardware. The CLI-052 startup warning remains in place.
 *  - otherwise → on only when stdout is an interactive TTY (ink writes no cursor sequences at
 *    all on a non-TTY, so this is defense in depth).
 */
export function supportsImeCursorPositioning(): boolean {
  const override = process.env.ROBOTA_IME_CURSOR;
  if (override === '1') return true;
  if (override === '0') return false;
  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return false; // I5
  return Boolean(process.stdout.isTTY);
}
