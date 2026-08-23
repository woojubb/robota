/**
 * REMOTE-014 E5 — the co-drive input queue: what happens to an input that arrives mid-turn.
 *
 * Split out of the execution controller, which had grown past its size ratchet. Deciding whether an
 * arriving input coalesces, appends or is dropped is its own job, and RUNTIME-003 made it one with
 * consequences: each of those outcomes now has to settle the handle its submitter is holding, or the
 * caller waits forever on a turn that will never run.
 */

import type { IQueuedInput } from './interactive-session-execution-controller.js';
import type { TDriverId, TTurnNotRunReason } from '@robota-sdk/agent-interface-session';

/**
 * REMOTE-014 E5: max co-drive queue depth — beyond this, drop-newest with an attributed notice.
 *
 * Declared HERE, where the queue that enforces it lives, and that placement is a review finding.
 * It sat in `interactive-session-execution-controller.ts`, which imports this file's class as a
 * VALUE at field-initialiser time (`readonly pending = new PendingInputQueue(...)`, evaluated while
 * the module loads) — so the two modules referred to each other at value level. It happened to work
 * because the constant is only read inside `enqueue()`, deferring the reference until both modules
 * had finished initialising; change the import order or the bundler and it becomes a TDZ crash.
 *
 * Working by accident is not the same as working. The controller only DECLARED it and never used
 * it; this file is its only reader, so ownership moved to the reader and the cycle is gone rather
 * than merely harmless.
 */
export const MAX_PENDING_QUEUE_DEPTH = 32;

export interface IQueueSettlers {
  /** Tell the holder of this submission's handle that it will never run. */
  // The reason type comes from the contract that owns it. Spelling the members here again would be
  // a second vocabulary to keep in step — and this file's own subject is a queue whose members
  // changed once already in review ('shutdown' was removed as unreachable).
  refuse: (turnId: string, reason: TTurnNotRunReason) => void;
  /** Release a wake gate for an entry that will never run (CORE-024/RUNTIME-19). */
  releaseWake: (wakeTaskId: string) => void;
}

export class PendingInputQueue {
  private entries: IQueuedInput[] = [];

  constructor(private readonly settlers: IQueueSettlers) {}

  /** The HEAD queued prompt (next to run), or null. */
  get head(): string | null {
    return this.entries[0]?.input ?? null;
  }

  get size(): number {
    return this.entries.length;
  }

  /** The queued entries, for a caller inspecting the queue's contents. */
  get contents(): readonly IQueuedInput[] {
    return this.entries;
  }

  /**
   * REMOTE-014 E5: enqueue an input while a turn is executing. Same-driver-as-tail COALESCES (tail-replace —
   * preserves today's editable-pending, last-wins-per-driver semantics + caps a single flooder); a different
   * driver APPENDS (never clobbers another's input). At capacity, drop-newest and return 'dropped' (the caller
   * emits an attributed notice). Releases a coalesced-away / dropped entry's `wakeTaskId` (CORE-024).
   */
  enqueue(entry: IQueuedInput): 'queued' | 'coalesced' | 'dropped' {
    // Internal TypeScript callers cannot omit this required field. Keep the original runtime
    // assertion byte-for-byte for untyped/JavaScript misuse, so type tightening does not weaken the
    // fail-fast admission boundary or manufacture a runtime behavior change.
    if (entry.turnId === undefined) {
      throw new Error(
        'pending queue: a queued submission needs its turnId — without one no refusal can settle ' +
          "its caller's handle, and the wait never ends. This is the RUNTIME-003 inert-queue " +
          'defect, caught at the enqueue rather than in a hang.',
      );
    }
    const tail = this.entries[this.entries.length - 1];
    if (tail && tail.options.driverId === entry.options.driverId) {
      if (
        tail.options.wakeTaskId !== undefined &&
        tail.options.wakeTaskId !== entry.options.wakeTaskId
      ) {
        this.settlers.releaseWake(tail.options.wakeTaskId);
      }
      // RUNTIME-003: the replaced entry never gets a turn — tell its holder now.
      this.settlers.refuse(tail.turnId, 'coalesced');
      this.entries[this.entries.length - 1] = entry;
      return 'coalesced';
    }
    if (this.entries.length >= MAX_PENDING_QUEUE_DEPTH) {
      if (entry.options.wakeTaskId !== undefined)
        this.settlers.releaseWake(entry.options.wakeTaskId);
      this.settlers.refuse(entry.turnId, 'dropped');
      return 'dropped';
    }
    this.entries.push(entry);
    return 'queued';
  }

  /**
   * Clear the WHOLE queue, releasing EVERY entry's `wakeTaskId` (CORE-024/RUNTIME-19 — a dropped wake must free
   * its gate or that task can never wake again). Returns the distinct driver ids whose input was cleared, so
   * the caller can emit an attributed `cancelled by <id>` notice (E5 co-drive).
   */
  clear(): TDriverId[] {
    const drivers: TDriverId[] = [];
    for (const entry of this.entries) {
      if (entry.options.wakeTaskId !== undefined)
        this.settlers.releaseWake(entry.options.wakeTaskId);
      this.settlers.refuse(entry.turnId, 'cancelled');
      const driver = entry.options.driverId;
      if (driver !== undefined && !drivers.includes(driver)) drivers.push(driver);
    }
    this.entries = [];
    return drivers;
  }

  /** Take the HEAD entry (submission order), or undefined when the queue is empty. */
  shift(): IQueuedInput | undefined {
    return this.entries.shift();
  }
}
