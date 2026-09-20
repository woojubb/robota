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

/** SCREEN-1992 TC-06: the negotiated terminal modes bracket the handoff. */
describe('TerminalHandoffController terminal-mode hooks', () => {
  it('runs preSuspend after suspend and postResume after resume, even when the child throws', async () => {
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
    c.setTerminalModeHooks({
      preSuspend: () => {
        order.push('mode-off');
      },
      postResume: () => {
        order.push('mode-on');
      },
    });

    await expect(
      c.runWithTerminal(async () => {
        order.push('child');
        throw new Error('child failed');
      }),
    ).rejects.toThrow('child failed');
    expect(order).toEqual(['suspend', 'mode-off', 'clear', 'child', 'resume', 'mode-on']);

    c.setTerminalModeHooks(undefined);
    order.length = 0;
    await c.runWithTerminal(async () => order.push('child'));
    expect(order).toEqual(['suspend', 'clear', 'child', 'resume']);
  });

  /**
   * SCREEN-2670: `preSuspend` may be async — it drains the parked screen-reader output — and the
   * screen is cleared only after it settles. Without the await, `clear` and the child would run
   * while the drain was still pending, and parked frames would land on top of the child's output.
   */
  it('awaits an async preSuspend before clearing the screen and starting the child', async () => {
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
    let finishDrain: () => void = () => {};
    const drained = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    c.setTerminalModeHooks({
      preSuspend: async () => {
        order.push('drain-start');
        await drained;
        order.push('drain-end');
      },
      postResume: () => {
        order.push('mode-on');
      },
    });

    const run = c.runWithTerminal(async () => order.push('child'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The drain has not settled: nothing past it may have run yet.
    expect(order).toEqual(['suspend', 'drain-start']);
    finishDrain();
    await run;
    expect(order).toEqual([
      'suspend',
      'drain-start',
      'drain-end',
      'clear',
      'child',
      'resume',
      'mode-on',
    ]);
  });
});
