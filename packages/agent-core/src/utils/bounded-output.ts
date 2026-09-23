/**
 * ARCH-056 (#2161): the bounded output-retention contract for child-process execution.
 *
 * Every path that reads a child's stdout/stderr must bound memory WHILE the output is being read —
 * not cap a summary afterwards while retaining the whole log. Before this existed, `shell-tool`
 * could buffer for ten minutes, the hook `CommandExecutor` repeated the pattern, and a subagent
 * runner had rediscovered a 4 KiB tail on its own. This module names the policy once:
 *
 * - **Budget.** `maxBytes` is the most that is ever RETAINED; bytes beyond it are dropped as they
 *   arrive, so memory is bounded by the budget, not by the child's lifetime.
 * - **Retention.** `head` keeps the first `maxBytes` (a tool result: what the command said first);
 *   `tail` keeps the last `maxBytes` (a diagnostic: how it ended).
 * - **Truncation is visible.** `truncated`, `droppedBytes` and a marker in `toString()` say that
 *   output was dropped and how much — never a silently shorter string.
 * - **No spill.** This contract never writes to disk; a caller that needs the whole stream owns a
 *   log file (background tasks do), and this buffer is what stays in memory beside it.
 * - **Termination is not here.** Exceeding the budget drops bytes; whether the child is killed is
 *   the caller's policy (CORE-023 owns process-tree termination).
 *
 * Chunks are `Uint8Array` (a Node `Buffer` is one), and decoding happens once at `toString()`, so a
 * multi-byte character split across a chunk boundary is never decoded twice.
 */

export type TOutputRetention = 'head' | 'tail';

export interface IBoundedOutputOptions {
  /** Most bytes ever retained. */
  readonly maxBytes: number;
  /** Which end to keep once over budget. Default `head`. */
  readonly retain?: TOutputRetention;
  /** Marker appended (head) or prepended (tail) to `toString()` when bytes were dropped. */
  readonly truncationMarker?: (droppedBytes: number) => string;
}

export interface IBoundedOutput {
  append(chunk: Uint8Array | string): void;
  /** Bytes currently retained (≤ `maxBytes`). */
  readonly retainedBytes: number;
  /** Bytes the child produced in total, retained or not. */
  readonly totalBytes: number;
  readonly droppedBytes: number;
  readonly truncated: boolean;
  /** The retained output, decoded as UTF-8, with the truncation marker when bytes were dropped. */
  toString(): string;
}

const DEFAULT_MARKER = (dropped: number): string =>
  `\n…[output truncated: ${dropped} byte(s) dropped]`;

export function createBoundedOutput(options: IBoundedOutputOptions): IBoundedOutput {
  const retain = options.retain ?? 'head';
  const marker = options.truncationMarker ?? DEFAULT_MARKER;
  const maxBytes = Math.max(0, Math.floor(options.maxBytes));
  const encoder = new TextEncoder();
  let chunks: Uint8Array[] = [];
  let retained = 0;
  let total = 0;

  const appendHead = (bytes: Uint8Array): void => {
    const room = maxBytes - retained;
    if (room <= 0) return;
    const kept = bytes.byteLength <= room ? bytes : bytes.subarray(0, room);
    chunks.push(kept);
    retained += kept.byteLength;
  };

  const appendTail = (bytes: Uint8Array): void => {
    const kept = bytes.byteLength <= maxBytes ? bytes : bytes.subarray(bytes.byteLength - maxBytes);
    chunks.push(kept);
    retained += kept.byteLength;
    // Drop whole leading chunks first, then trim the oldest survivor — O(chunks), no re-copying.
    while (retained > maxBytes && chunks.length > 0) {
      const oldest = chunks[0] as Uint8Array;
      const excess = retained - maxBytes;
      if (oldest.byteLength <= excess) {
        chunks.shift();
        retained -= oldest.byteLength;
      } else {
        chunks[0] = oldest.subarray(excess);
        retained -= excess;
      }
    }
  };

  return {
    append(chunk) {
      const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
      total += bytes.byteLength;
      if (retain === 'head') appendHead(bytes);
      else appendTail(bytes);
    },
    get retainedBytes() {
      return retained;
    },
    get totalBytes() {
      return total;
    },
    get droppedBytes() {
      return total - retained;
    },
    get truncated() {
      return total > retained;
    },
    toString() {
      const joined = new Uint8Array(retained);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      chunks = chunks.length > 1 ? [joined] : chunks;
      const text = new TextDecoder().decode(joined);
      if (total <= retained) return text;
      const note = marker(total - retained);
      return retain === 'head' ? `${text}${note}` : `${note.replace(/^\n/, '')}\n${text}`;
    },
  };
}
