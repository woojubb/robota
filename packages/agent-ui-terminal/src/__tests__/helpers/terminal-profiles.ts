/**
 * CLI-062 — the terminal matrix, as data.
 *
 * The backlog item's remaining work was a *manual* matrix ("iTerm2 + Terminal.app
 * ±ROBOTA_IME_CURSOR, kitty/WezTerm/Ghostty/Windows Terminal/tmux on real hardware"). This module
 * converts it into something a machine re-runs: each row is the environment handshake a terminal
 * emulator hands the program it launches, which is the ONLY channel through which the emulator's
 * identity reaches our code (`supportsImeCursorPositioning()` reads `TERM_PROGRAM`).
 *
 * Two consumers share this table so the gate is never asserted in isolation from behaviour:
 *  - `terminal-capabilities.test.ts` — what `supportsImeCursorPositioning()` returns per row.
 *  - `pty/ime-cursor.ptytest.ts`     — what the REAL binary then does under a real pty per row.
 *
 * `provenance` is deliberately explicit about how each row's values were obtained. `measured`
 * rows were captured by launching that emulator on the machine that recorded them and dumping the
 * child environment; `documented` rows come from the vendor's documented behaviour because the
 * emulator cannot run on Linux (macOS/Windows) or is not installed. A documented row still gives
 * real coverage of OUR code — the branch it selects is exercised end-to-end — but it is NOT
 * evidence about that emulator's own rendering or its OS IME, and must never be reported as such.
 */

export type TerminalProvenance = 'measured' | 'documented';

export interface ITerminalProfile {
  /** Stable id used in test names and in the backlog matrix table. */
  id: string;
  /** Human label for the matrix. */
  label: string;
  /** Environment the emulator exports to its child process. */
  env: Readonly<Record<string, string>>;
  /** How the env values above were obtained. */
  provenance: TerminalProvenance;
  /** Free-text provenance detail (version, capture method, or the vendor fact relied on). */
  note: string;
}

export const TERMINAL_PROFILES: readonly ITerminalProfile[] = [
  {
    id: 'bare-tty',
    label: 'bare TTY (no TERM_PROGRAM)',
    env: { TERM: 'xterm-256color' },
    provenance: 'measured',
    note: 'Baseline: a pty that identifies nothing. This is also what the pty harness itself provides.',
  },
  {
    id: 'ghostty',
    label: 'Ghostty',
    env: {
      TERM: 'xterm-ghostty',
      TERM_PROGRAM: 'ghostty',
      TERM_PROGRAM_VERSION: '1.3.1',
      COLORTERM: 'truecolor',
    },
    provenance: 'measured',
    note: 'Captured from Ghostty 1.3.1 (Linux/GTK4) by launching it with `-e <env dump>`.',
  },
  {
    id: 'gnome-terminal',
    label: 'GNOME Terminal (VTE)',
    env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    provenance: 'measured',
    note: 'Captured from GNOME Terminal 3.52.0 / VTE 0.76.0; VTE sets no TERM_PROGRAM.',
  },
  {
    id: 'tmux',
    label: 'tmux (multiplexer)',
    env: { TERM: 'tmux-256color', TERM_PROGRAM: 'tmux', TMUX: '/tmp/tmux-fixture,1,0' },
    provenance: 'measured',
    note: 'Captured from tmux 3.4 inside a real pane; tmux 3.4 sets TERM_PROGRAM=tmux. The real emulator is additionally driven end-to-end in pty/ime-cursor-tmux.ptytest.ts.',
  },
  {
    id: 'kitty',
    label: 'kitty',
    env: { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1', COLORTERM: 'truecolor' },
    provenance: 'documented',
    note: 'kitty identifies itself via TERM=xterm-kitty + KITTY_WINDOW_ID and sets no TERM_PROGRAM.',
  },
  {
    id: 'wezterm',
    label: 'WezTerm',
    env: { TERM: 'xterm-256color', TERM_PROGRAM: 'WezTerm', TERM_PROGRAM_VERSION: '20240203' },
    provenance: 'documented',
    note: 'WezTerm sets TERM_PROGRAM=WezTerm.',
  },
  {
    id: 'windows-terminal',
    label: 'Windows Terminal',
    env: { TERM: 'xterm-256color', WT_SESSION: '00000000-0000-0000-0000-000000000000' },
    provenance: 'documented',
    note: 'Windows Terminal marks its sessions with WT_SESSION and sets no TERM_PROGRAM.',
  },
  {
    id: 'iterm2',
    label: 'iTerm2 (macOS)',
    env: { TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.0' },
    provenance: 'documented',
    note: 'macOS-only emulator: the env branch is exercised here, its rendering and its OS IME are not.',
  },
  {
    id: 'apple-terminal',
    label: 'Terminal.app (macOS)',
    env: { TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal', TERM_PROGRAM_VERSION: '455' },
    provenance: 'documented',
    note: 'macOS-only emulator, and the ONE profile that is off by default (invariant I5). The env branch is exercised here; the historical Korean-IME SIGSEGV can only be re-checked on macOS.',
  },
];

/** `ROBOTA_IME_CURSOR` settings the matrix sweeps. `undefined` means the variable is absent. */
export const IME_CURSOR_SETTINGS: readonly (string | undefined)[] = [undefined, '1', '0'];

export const REPRESENTATIVE_IME_PTY_CELLS: readonly {
  profileId: string;
  override: string | undefined;
}[] = [
  { profileId: 'ghostty', override: undefined },
  { profileId: 'apple-terminal', override: undefined },
  { profileId: 'apple-terminal', override: '1' },
  { profileId: 'ghostty', override: '0' },
];

/**
 * The expected `supportsImeCursorPositioning()` verdict for a matrix cell, derived from the
 * documented precedence (explicit override wins; Apple_Terminal is off by default; every other
 * interactive TTY is on). Both the unit matrix and the pty matrix assert against this, so the
 * capability detection and the observable behaviour can never drift apart silently.
 */
export function expectedImeCursorEnabled(
  profile: ITerminalProfile,
  override: string | undefined,
): boolean {
  if (override === '1') return true;
  if (override === '0') return false;
  return profile.env['TERM_PROGRAM'] !== 'Apple_Terminal';
}

/** Environment for a child process running "under" `profile` with the given override. */
export function profileEnv(
  profile: ITerminalProfile,
  override: string | undefined,
): Record<string, string> {
  return {
    ...profile.env,
    ...(override === undefined ? {} : { ROBOTA_IME_CURSOR: override }),
  };
}

/** Matrix label used in test names and in the backlog's evidence table. */
export function cellLabel(profile: ITerminalProfile, override: string | undefined): string {
  const setting =
    override === undefined ? 'ROBOTA_IME_CURSOR unset' : `ROBOTA_IME_CURSOR=${override}`;
  return `${profile.label} / ${setting}`;
}
