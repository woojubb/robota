/**
 * FLOW-004 (monitor): turns a process's output stream into agent-wake signals.
 *
 * Buffers partial lines across chunks, matches each complete line against a regular
 * expression, and — on a match — produces an agent-wake instruction carrying the matched
 * line. A cooldown coalesces bursts so chatty output does not flood the agent with wakes.
 */

export interface ILineWakeMatcherOptions {
  /** Regular-expression source matched against each complete output line. */
  matchPattern: string;
  /** Instruction injected on a match; the matched line is appended as context. */
  agentInstruction: string;
  /** Emit a wake with the composed instruction. */
  emit: (instruction: string) => void;
  /** Minimum gap between emitted wakes (coalesces bursts). Default 1000ms. */
  cooldownMs?: number;
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

export interface ILineWakeMatcher {
  /** Feed a stdout/stderr chunk; emits a wake for each matching line, subject to cooldown. */
  push(chunk: string): void;
}

const DEFAULT_COOLDOWN_MS = 1000;

export function createLineWakeMatcher(options: ILineWakeMatcherOptions): ILineWakeMatcher {
  const regex = new RegExp(options.matchPattern);
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = options.now ?? ((): number => Date.now());
  let buffer = '';
  let lastEmitAt = Number.NEGATIVE_INFINITY;

  return {
    push(chunk: string): void {
      buffer += chunk;
      const segments = buffer.split('\n');
      // The last segment is an incomplete line (no trailing newline yet) — keep it buffered.
      buffer = segments.pop() ?? '';
      for (const line of segments) {
        if (!regex.test(line)) continue;
        const at = now();
        if (at - lastEmitAt < cooldownMs) continue; // coalesce burst
        lastEmitAt = at;
        options.emit(`${options.agentInstruction}\n\nMatched output line: ${line.trim()}`);
      }
    },
  };
}
