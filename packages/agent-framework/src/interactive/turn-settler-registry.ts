/**
 * RUNTIME-003 — one entry per accepted submission, until its turn ends or it is refused one.
 *
 * Split out of the execution controller, which had grown well past its size ratchet. The controller
 * runs turns; keeping track of who is waiting on which submission is a different job, and it is the
 * job that makes `ITurnHandle.completed` able to promise it always settles.
 */

import { randomUUID } from 'node:crypto';

import type { TTurnNotRunReason } from '@robota-sdk/agent-interface-transport';

import { TurnNotRunError } from './turn-not-run-error.js';
import type { IExecutionResult } from './types.js';

export class TurnSettlerRegistry {
  /**
   * RUNTIME-003: one entry per accepted submission, until its turn ends or it is refused a turn.
   *
   * The map is what makes `ITurnHandle.completed` able to promise it always settles: every way a
   * submission can stop existing — it ran, it was coalesced away, it was dropped at capacity, the
   * queue was cleared, the session shut down — goes through `settleTurn` or `failTurn`, so nothing
   * can leave a caller waiting on a turn that will never come.
   */
  private readonly settlers = new Map<
    string,
    {
      promise: Promise<IExecutionResult>;
      resolve: (result: IExecutionResult) => void;
      reject: (error: Error) => void;
    }
  >();

  /**
   * Accept a submission and give it an identity. The promise is registered before the caller can do
   * anything with it, so a turn that ends synchronously still finds its settler.
   */
  begin(): { turnId: string; completed: Promise<IExecutionResult> } {
    const turnId = randomUUID();
    let settle!: { resolve: (r: IExecutionResult) => void; reject: (e: Error) => void };
    const completed = new Promise<IExecutionResult>((resolve, reject) => {
      settle = { resolve, reject };
    });
    this.settlers.set(turnId, { promise: completed, ...settle });
    // A caller may ignore the handle entirely — `void session.submit(...)` is how autonomous turns
    // are started here. Without a handler attached, a submission that is later coalesced away would
    // reject into an unhandled rejection and crash a strict host, so the rejection is marked handled
    // here and the ORIGINAL promise is what the caller receives.
    completed.catch(() => {});
    return { turnId, completed };
  }

  /**
   * The promise already registered for an accepted submission.
   *
   * The queue drain re-enters `submit` for an input that was accepted earlier, and its caller is
   * holding the promise from THAT acceptance. Handing back the same one is the whole point: minting
   * a second promise here would settle something nobody is waiting on. Returns a rejected promise
   * for an id this controller does not know.
   *
   * "Already settled" is the ordinary way to get there and was once written here as the ONLY way.
   * Review showed another: `resumeTurnId` is documented as set only by the queue drain, and nothing
   * enforces that, so an internal caller passing an unregistered id reaches this same rejection.
   * Both are refusals the caller can act on, and neither is a state this registry can distinguish —
   * which is the argument for typing the optionality away rather than for guessing here.
   */
  completionOf(turnId: string): Promise<IExecutionResult> {
    const registered = this.settlers.get(turnId);
    if (registered) return registered.promise;
    const orphan = Promise.reject(new TurnNotRunError(turnId, 'cancelled'));
    orphan.catch(() => {});
    return orphan;
  }

  /** The turn ended. Settles the caller's handle with the result it produced. */
  settle(turnId: string | undefined, result: IExecutionResult): void {
    if (turnId === undefined) return;
    this.settlers.get(turnId)?.resolve(result);
    this.settlers.delete(turnId);
  }

  /** The turn threw. The caller's handle rejects with the same error the turn failed on. */
  fail(turnId: string | undefined, error: Error): void {
    if (turnId === undefined) return;
    this.settlers.get(turnId)?.reject(error);
    this.settlers.delete(turnId);
  }

  /** The submission never became a turn, and the caller is told which of the ways happened. */
  refuse(turnId: string | undefined, reason: TTurnNotRunReason): void {
    if (turnId === undefined) return;
    this.settlers.get(turnId)?.reject(new TurnNotRunError(turnId, reason));
    this.settlers.delete(turnId);
  }
}
