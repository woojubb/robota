/**
 * TERM-002: TUI implementation of the `ITerminalHandoff` transport contract.
 *
 * Manual suspend/resume (NOT Ink 7.1.0 `suspendTerminal`): while a child process owns the real
 * terminal, the App renders nothing so Ink unmounts its input hooks and releases raw mode; the Ink
 * frame is cleared; the caller's `fn` runs the child with inherited stdio; then the App re-renders.
 *
 * The framework (`InteractiveSession`) owns the orchestration (exclusivity, fast-fail) — this class
 * only performs the actual screen release/reclaim. It spawns nothing itself (platform-neutral).
 */
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

/** How the App suspends/resumes its rendering, registered into the controller on mount. */
export interface ITuiSuspendHooks {
  /** Render nothing (release Ink input/raw mode); resolves once that has committed. */
  suspend(): Promise<void>;
  /** Resume rendering and force a redraw. */
  resume(): void;
}

/**
 * SCREEN-1992: terminal modes the TUI negotiated (focus reporting) are released before a child owns
 * the terminal and re-negotiated once it is reclaimed, so the child never receives `CSI I`/`CSI O`
 * and a child that reset the mode does not leave the TUI blind afterwards.
 */
export interface ITerminalModeHooks {
  preSuspend(): void;
  postResume(): void;
}

/** Minimal slice of the Ink render instance the controller needs. */
export interface IInkClearable {
  clear(): void;
}

export class TerminalHandoffController implements ITerminalHandoff {
  private hooks?: ITuiSuspendHooks;
  private instance?: IInkClearable;
  private modeHooks?: ITerminalModeHooks;

  /**
   * The App registers how to suspend/resume Ink. Returns an unregister function for cleanup on
   * unmount. Only a mounted App provides these hooks, which gates `canHandoffTerminal`.
   */
  registerSuspendHooks(hooks: ITuiSuspendHooks): () => void {
    this.hooks = hooks;
    return () => {
      if (this.hooks === hooks) this.hooks = undefined;
    };
  }

  /** render.tsx registers the terminal-mode bracket (SCREEN-1992) before `render()`. */
  setTerminalModeHooks(hooks: ITerminalModeHooks | undefined): void {
    this.modeHooks = hooks;
  }

  /** render.tsx supplies the Ink instance (for `clear()`) after `render()` returns. */
  setInkInstance(instance: IInkClearable): void {
    this.instance = instance;
  }

  get canHandoffTerminal(): boolean {
    return (
      process.stdin.isTTY === true && process.stdout.isTTY === true && this.hooks !== undefined
    );
  }

  async runWithTerminal<T>(fn: () => Promise<T>): Promise<T> {
    const hooks = this.hooks;
    if (!this.canHandoffTerminal || hooks === undefined) {
      throw new Error(
        'TUI terminal handoff unavailable: no interactive TTY, or the App is not mounted.',
      );
    }
    await hooks.suspend();
    this.modeHooks?.preSuspend();
    this.instance?.clear();
    // Releasing Ink's React input hooks (empty render) is not enough: the parent process still holds
    // a raw-mode TTY read on stdin, which (a) steals input from the inherited child and (b) starves
    // the parent event loop so the child's exit is never observed — the handoff would hang forever.
    // Explicitly hand stdin to the child by dropping raw mode and pausing the parent's reader; Ink
    // re-grabs stdin (raw mode + resume) when its input hooks re-mount on resume.
    const stdin = process.stdin;
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
    stdin.pause();
    try {
      return await fn();
    } finally {
      // Always reclaim the screen, even when the child failed. Re-rendering re-mounts the input
      // hooks, which is what restores raw mode and resumes the parent's stdin reader.
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
      stdin.resume();
      hooks.resume();
      this.modeHooks?.postResume();
    }
  }
}
