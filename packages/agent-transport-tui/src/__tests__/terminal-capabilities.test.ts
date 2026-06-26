import { afterEach, describe, expect, it } from 'vitest';
import { isInteractiveColorTerminal } from '../terminal-capabilities.js';

const ORIG_NO_COLOR = process.env.NO_COLOR;
const ORIG_FORCE_COLOR = process.env.FORCE_COLOR;
const ORIG_TTY = process.stdout.isTTY;

function setTty(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
}

function restoreEnv(key: 'NO_COLOR' | 'FORCE_COLOR', value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('isInteractiveColorTerminal', () => {
  afterEach(() => {
    restoreEnv('NO_COLOR', ORIG_NO_COLOR);
    restoreEnv('FORCE_COLOR', ORIG_FORCE_COLOR);
    Object.defineProperty(process.stdout, 'isTTY', { value: ORIG_TTY, configurable: true });
  });

  it('NO_COLOR present disables even when empty (the SCREEN-008 regression)', () => {
    delete process.env.FORCE_COLOR;
    setTty(true);
    process.env.NO_COLOR = '';
    expect(isInteractiveColorTerminal()).toBe(false);
    process.env.NO_COLOR = '1';
    expect(isInteractiveColorTerminal()).toBe(false);
  });

  it('honors FORCE_COLOR (0 → off, non-zero → on)', () => {
    delete process.env.NO_COLOR;
    setTty(false);
    process.env.FORCE_COLOR = '0';
    expect(isInteractiveColorTerminal()).toBe(false);
    process.env.FORCE_COLOR = '1';
    expect(isInteractiveColorTerminal()).toBe(true);
  });

  it('falls back to stdout.isTTY when no env override', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    setTty(true);
    expect(isInteractiveColorTerminal()).toBe(true);
    setTty(false);
    expect(isInteractiveColorTerminal()).toBe(false);
  });
});
