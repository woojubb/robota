import { afterEach, describe, expect, it, vi } from 'vitest';
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
