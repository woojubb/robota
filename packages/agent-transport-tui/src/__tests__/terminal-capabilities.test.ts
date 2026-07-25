import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IME_CURSOR_SETTINGS,
  TERMINAL_PROFILES,
  cellLabel,
  expectedImeCursorEnabled,
} from './helpers/terminal-profiles.js';
import {
  isInteractiveColorTerminal,
  supportsImeCursorPositioning,
} from '../terminal-capabilities.js';

const ORIG_TTY = process.stdout.isTTY;

function setTty(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
}

describe('isInteractiveColorTerminal', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process.stdout, 'isTTY', { value: ORIG_TTY, configurable: true });
  });

  it('NO_COLOR present disables even when empty (the SCREEN-008 regression)', () => {
    vi.stubEnv('FORCE_COLOR', undefined);
    setTty(true);
    vi.stubEnv('NO_COLOR', '');
    expect(isInteractiveColorTerminal()).toBe(false);
    vi.stubEnv('NO_COLOR', '1');
    expect(isInteractiveColorTerminal()).toBe(false);
  });

  it('honors FORCE_COLOR (0 → off, non-zero → on)', () => {
    vi.stubEnv('NO_COLOR', undefined);
    setTty(false);
    vi.stubEnv('FORCE_COLOR', '0');
    expect(isInteractiveColorTerminal()).toBe(false);
    vi.stubEnv('FORCE_COLOR', '1');
    expect(isInteractiveColorTerminal()).toBe(true);
  });

  it('falls back to stdout.isTTY when no env override', () => {
    vi.stubEnv('NO_COLOR', undefined);
    vi.stubEnv('FORCE_COLOR', undefined);
    setTty(true);
    expect(isInteractiveColorTerminal()).toBe(true);
    setTty(false);
    expect(isInteractiveColorTerminal()).toBe(false);
  });
});

describe('supportsImeCursorPositioning (CLI-062)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process.stdout, 'isTTY', { value: ORIG_TTY, configurable: true });
  });

  it('on for a plain interactive TTY, off for a non-TTY', () => {
    vi.stubEnv('ROBOTA_IME_CURSOR', undefined);
    vi.stubEnv('TERM_PROGRAM', undefined);
    setTty(true);
    expect(supportsImeCursorPositioning()).toBe(true);
    setTty(false);
    expect(supportsImeCursorPositioning()).toBe(false);
  });

  it('I5: Apple_Terminal is OFF by default (Korean-IME SIGSEGV is an Apple-side bug)', () => {
    vi.stubEnv('ROBOTA_IME_CURSOR', undefined);
    setTty(true);
    vi.stubEnv('TERM_PROGRAM', 'Apple_Terminal');
    expect(supportsImeCursorPositioning()).toBe(false);
  });

  it('I5: ROBOTA_IME_CURSOR=1 opts Apple_Terminal in explicitly', () => {
    setTty(true);
    vi.stubEnv('TERM_PROGRAM', 'Apple_Terminal');
    vi.stubEnv('ROBOTA_IME_CURSOR', '1');
    expect(supportsImeCursorPositioning()).toBe(true);
  });

  it('ROBOTA_IME_CURSOR=0 is a kill switch even on a capable terminal', () => {
    setTty(true);
    vi.stubEnv('TERM_PROGRAM', undefined);
    vi.stubEnv('ROBOTA_IME_CURSOR', '0');
    expect(supportsImeCursorPositioning()).toBe(false);
  });
});

/**
 * CLI-062 terminal matrix — capability half.
 *
 * Terminal detection is ASSERTED here, never assumed: every emulator in the matrix is applied as
 * the environment handshake it really exports (see helpers/terminal-profiles.ts for how each row's
 * values were obtained), and the gate's verdict is compared against the shared expectation the pty
 * matrix asserts behaviourally. The macOS rows (Terminal.app, iTerm2) cannot run their emulator on
 * a non-macOS machine, but their env branch — including Apple_Terminal's default-off I5 branch —
 * is fully exercised by stubbing the variables those terminals set.
 */
describe('CLI-062 terminal matrix — supportsImeCursorPositioning per terminal', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process.stdout, 'isTTY', { value: ORIG_TTY, configurable: true });
  });

  for (const profile of TERMINAL_PROFILES) {
    for (const override of IME_CURSOR_SETTINGS) {
      const expected = expectedImeCursorEnabled(profile, override);
      it(`${cellLabel(profile, override)} → ${expected ? 'ENABLED' : 'disabled'}`, () => {
        setTty(true);
        // A real terminal exports only its own variables; anything the matrix does not set must
        // be genuinely absent, or a leaked TERM_PROGRAM would silently decide the verdict.
        for (const key of ['TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'COLORTERM']) {
          vi.stubEnv(key, undefined);
        }
        for (const [key, value] of Object.entries(profile.env)) vi.stubEnv(key, value);
        vi.stubEnv('ROBOTA_IME_CURSOR', override);

        expect(supportsImeCursorPositioning()).toBe(expected);
      });
    }
  }

  it('every matrix row keeps its provenance honest (measured rows name a real capture)', () => {
    for (const profile of TERMINAL_PROFILES) {
      expect(profile.note.length, profile.id).toBeGreaterThan(0);
      if (profile.provenance === 'measured') {
        expect(profile.note, profile.id).toMatch(/Captured|pty harness/);
      }
    }
  });
});
