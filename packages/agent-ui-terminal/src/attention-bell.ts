/**
 * CLI-2004 — the audible attention signal.
 *
 * Three triggers, all of them "the session now needs you and you cannot see that it does": a reply
 * finished, a prompt or dialog wants an answer, and a tool that ran long enough that you had stopped
 * watching has finished.
 *
 * The long-tool threshold is a NAMED CONSTANT rather than a copied literal. It comes from a single
 * reference, so it is the kind of number that has to be tunable and attributable — not folded into
 * an inline `> 5000`.
 *
 * Written outside Ink for the same reason as `terminal-marks.ts`: BEL is terminal framing, not
 * rendered content.
 */

/** A tool that took longer than this rings on completion. Single-reference; tunable by design. */
export const LONG_TOOL_BELL_MS = 5000;

/** The bell byte. */
export const BELL = '\x07';

export interface IAttentionBellOptions {
  /** Screen-reader mode. Off ⇒ nothing is ever written. */
  enabled: boolean;
  /** Injected sink; defaults to the process's own stdout. */
  write?: (text: string) => void;
  /** Injected clock so the threshold is testable without real time. */
  now?: () => number;
  /** Override the long-tool threshold. */
  longToolBellMs?: number;
}

export interface IAttentionBell {
  /** The assistant finished a reply. */
  replyCompleted(): void;
  /** A prompt or dialog mounted and is waiting for an answer. */
  promptMounted(): void;
  /** Record a tool's start so its duration can be judged at completion. */
  toolStarted(toolId: string): void;
  /** A tool finished — rings only if its recorded start is older than the threshold. */
  toolCompleted(toolId: string): void;
}

/**
 * Build the bell. A tool whose start was never recorded never rings: the signal is "the thing you
 * stopped waiting for is done", and without a start there is no duration to judge, so silence is the
 * correct answer rather than a guessed one.
 */
export function createAttentionBell(options: IAttentionBellOptions): IAttentionBell {
  const write =
    options.write ??
    ((text: string): void => {
      process.stdout.write(text);
    });
  const now = options.now ?? ((): number => Date.now());
  const threshold = options.longToolBellMs ?? LONG_TOOL_BELL_MS;
  const startedAt = new Map<string, number>();

  const ring = (): void => {
    if (!options.enabled) return;
    write(BELL);
  };

  return {
    replyCompleted: ring,
    promptMounted: ring,
    toolStarted(toolId: string): void {
      if (!options.enabled) return;
      startedAt.set(toolId, now());
    },
    toolCompleted(toolId: string): void {
      const started = startedAt.get(toolId);
      startedAt.delete(toolId);
      if (started === undefined) return;
      if (now() - started <= threshold) return;
      ring();
    },
  };
}
