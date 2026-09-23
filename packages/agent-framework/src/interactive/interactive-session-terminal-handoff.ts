/**
 * TERM-001: the terminal-handoff ORCHESTRATION the framework owns — exclusivity and the fast-fail
 * when no interactive terminal is available — over the transport-provided suspend/resume.
 *
 * Split out of `interactive-session.ts` (CLI-1994) along the seam the members already drew: the two
 * host-role members read one capability and one flag, and nothing else in the class touches either.
 */

import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

export class SessionTerminalHandoffGate {
  /** Guards handoff exclusivity (one handoff at a time). */
  private active = false;

  constructor(private readonly handoff: ITerminalHandoff | undefined) {}

  /**
   * Whether the active transport can hand the real terminal to a child process. False when no
   * handoff capability was injected or its `canHandoffTerminal` is false (e.g. headless).
   */
  canHandoffTerminal(): boolean {
    return this.handoff?.canHandoffTerminal === true;
  }

  /**
   * Suspend the display, run `fn` (which spawns a child with inherited stdio), then restore. The
   * framework enforces exclusivity and fast-fails when no interactive terminal is available instead
   * of hanging; the transport implements the underlying suspend/resume; the caller's `fn` spawns
   * whatever child it wants — the framework stays platform-neutral and never spawns a shell.
   */
  async runWithTerminal<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canHandoffTerminal() || this.handoff === undefined) {
      throw new Error(
        'Terminal handoff is unavailable: no interactive terminal (headless or non-TTY output).',
      );
    }
    if (this.active) {
      throw new Error('A terminal handoff is already in progress.');
    }
    this.active = true;
    try {
      return await this.handoff.runWithTerminal(fn);
    } finally {
      this.active = false;
    }
  }
}
