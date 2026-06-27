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
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-transport';

/** How the App suspends/resumes its rendering, registered into the controller on mount. */
export interface ITuiSuspendHooks {
  /** Render nothing (release Ink input/raw mode); resolves once that has committed. */
  suspend(): Promise<void>;
  /** Resume rendering and force a redraw. */
  resume(): void;
}

/** Minimal slice of the Ink render instance the controller needs. */
export interface IInkClearable {
  clear(): void;
}

export class TerminalHandoffController implements ITerminalHandoff {
  private hooks?: ITuiSuspendHooks;
  private instance?: IInkClearable;

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
    this.instance?.clear();
    try {
      return await fn();
    } finally {
      // Always reclaim the screen, even when the child failed.
      hooks.resume();
    }
  }
}
