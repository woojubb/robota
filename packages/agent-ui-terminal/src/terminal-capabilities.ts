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

/**
 * CLI-2004 — may this process write OSC 133 shell-integration marks at agent-turn boundaries?
 *
 * The marks are otherwise harmless: every emulator surveyed discards an unknown OSC sequence, so
 * this gate carries DOCUMENTED negatives, not a capability probe. Robota's support table (the TUI
 * package's docs/SPEC.md) is the user-facing half of the same list.
 *
 * Precedence:
 *  - `ROBOTA_TURN_MARKS=1` → on (opt back in on a terminal listed below).
 *  - `ROBOTA_TURN_MARKS=0` → off (kill switch).
 *  - `TERM_PROGRAM=WezTerm` → off: WezTerm treats OSC 133 as shell-owned and a non-shell emitter
 *    corrupts its own prompt tracking, so the marks are withheld rather than emitted uselessly.
 *  - otherwise → on only when stdout is an interactive TTY. Nothing consumes the marks in a pipe,
 *    and they would land in a captured transcript as noise.
 */
export function supportsTurnMarks(): boolean {
  const override = process.env.ROBOTA_TURN_MARKS;
  if (override === '1') return true;
  if (override === '0') return false;
  if (process.env.TERM_PROGRAM === 'WezTerm') return false;
  return Boolean(process.stdout.isTTY);
}
