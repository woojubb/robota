/**
 * What the TUI releases before another program has the terminal, and takes back after.
 *
 * Focus reporting is turned off for the child and on again after it. Output parked for a screen
 * reader
 * is drained first, so none lands on top of the child's. The composer's stdin proxy forwards
 * nothing in between, because stdin then belongs to whoever has
 * the terminal — and the passphrase prompt on Windows reads the console through that same stream.
 */
import type { ITerminalModeHooks } from './terminal-handoff-controller.js';

export interface ITerminalModeHookParts {
  readonly focusReporting: { enable(): void; disable(): void };
  /** Present only when screen-reader output is parked. */
  readonly parked?: { drain(): Promise<void> };
  readonly stdin: { hold(): void; release(): void };
}

export function createTerminalModeHooks(parts: ITerminalModeHookParts): ITerminalModeHooks {
  return {
    preSuspend: async () => {
      parts.stdin.hold();
      parts.focusReporting.disable();
      await parts.parked?.drain();
    },
    postResume: () => {
      // Released before anything is read again: the controller has resumed stdin, but no chunk is
      // delivered until this synchronous step has returned.
      parts.stdin.release();
      parts.focusReporting.enable();
    },
  };
}
