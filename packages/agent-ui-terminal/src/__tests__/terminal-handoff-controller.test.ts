/**
 * TERM-002: unit tests for the TUI terminal-handoff controller LOGIC.
 *
 * The real Ink suspend/resume + child-process TTY handoff can only be validated on a live terminal
 * (manual / User Execution evidence). These tests pin the controller's observable contract: TTY +
 * mounted-App gating, and the suspend → clear → fn → resume order (including resume-on-throw).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TerminalHandoffController } from '../terminal-handoff-controller.js';

const origStdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const origStdout = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function setTty(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
}

afterEach(() => {
  if (origStdin) Object.defineProperty(process.stdin, 'isTTY', origStdin);
  if (origStdout) Object.defineProperty(process.stdout, 'isTTY', origStdout);
});

describe('TerminalHandoffController', () => {
  it('canHandoffTerminal requires a TTY on both streams AND registered App hooks', () => {
    const c = new TerminalHandoffController();
    setTty(true, true);
    expect(c.canHandoffTerminal).toBe(false); // no hooks yet

    const unregister = c.registerSuspendHooks({ suspend: async () => {}, resume: () => {} });
    expect(c.canHandoffTerminal).toBe(true);

    setTty(false, true);
    expect(c.canHandoffTerminal).toBe(false); // stdin not a TTY

    setTty(true, true);
    unregister();
    expect(c.canHandoffTerminal).toBe(false); // App unmounted
  });

  it('runs suspend → clear → fn → resume in order', async () => {
    const order: string[] = [];
    const c = new TerminalHandoffController();
    setTty(true, true);
    c.registerSuspendHooks({
      suspend: async () => {
        order.push('suspend');
      },
      resume: () => order.push('resume'),
    });
    c.setInkInstance({ clear: () => order.push('clear') });

    const result = await c.runWithTerminal(async () => {
      order.push('child');
      return 7;
    });

    expect(result).toBe(7);
    expect(order).toEqual(['suspend', 'clear', 'child', 'resume']);
  });

  it('resumes even when the child fn throws', async () => {
    const order: string[] = [];
    const c = new TerminalHandoffController();
    setTty(true, true);
    c.registerSuspendHooks({
      suspend: async () => void order.push('suspend'),
      resume: () => order.push('resume'),
    });

    await expect(
      c.runWithTerminal(async () => {
        throw new Error('child failed');
      }),
    ).rejects.toThrow('child failed');
    expect(order).toEqual(['suspend', 'resume']);
  });

  it('rejects (does not run fn) when no interactive TTY is available', async () => {
    const c = new TerminalHandoffController();
    setTty(false, false);
    c.registerSuspendHooks({ suspend: async () => {}, resume: () => {} });
    const fn = vi.fn();
    await expect(c.runWithTerminal(fn as never)).rejects.toThrow(/unavailable/);
    expect(fn).not.toHaveBeenCalled();
  });
});
