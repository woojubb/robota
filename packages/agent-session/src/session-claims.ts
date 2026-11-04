/**
 * Claims on session ids (#3679 step 3e): the ids a session in this process runs — in a store that
 * seals, the ones it answers only from content the owner wrote.
 *
 * A claim is exclusive within one store, released by its own handle only, and fences saves: a save
 * of a claimed id must carry the live claim, and one carrying a claim that has ended is refused, so a
 * session that outlived its claim (a shutdown that timed out) cannot overwrite the session that
 * claimed the id after it. Every store keeps them, sealing or not, so no store lets a session run
 * unclaimed. A claim lives in the memory of the store's process and ends with it.
 */

import type { ISessionClaim, TSessionLoadOutcome } from '@robota-sdk/agent-interface-session';

/** Why a claim or a save was refused. */
export type TSessionClaimRefusal =
  /** The id is already claimed in this store, by another session or by a write-only child's copy. */
  | 'claimed'
  /** The save carried a claim that is not this id's live claim: it ended, or it is another id's. */
  | 'released'
  /** The record is handed to another process that may still save it, until that export ends. */
  | 'exported';

function claimRefusalMessage(sessionId: string, reason: TSessionClaimRefusal): string {
  switch (reason) {
    case 'claimed':
      return `Session ${sessionId} is already claimed by a session running in this process.`;
    case 'released':
      return `Session ${sessionId} was not saved: the claim it was saved under has ended.`;
    case 'exported':
      return (
        `Session ${sessionId} is handed to a subagent process that may still save it; open it ` +
        'once that job has ended.'
      );
  }
}

/** A claim, or a save under one, that the store refused. Fixed text and the session id only. */
export class SessionClaimedError extends Error {
  readonly code = 'SESSION_CLAIMED' as const;
  readonly sessionId: string;
  readonly reason: TSessionClaimRefusal;

  constructor(sessionId: string, reason: TSessionClaimRefusal) {
    super(claimRefusalMessage(sessionId, reason));
    this.name = 'SessionClaimedError';
    this.sessionId = sessionId;
    this.reason = reason;
  }
}

/**
 * Whether `error` is a {@link SessionClaimedError}, by `code`: this package ships an ES and a CommonJS
 * build, and the framework and a host that load one each see two classes no `instanceof` matches across.
 */
export function isSessionClaimedError(error: unknown): error is SessionClaimedError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === 'SESSION_CLAIMED'
  );
}

/** One live claim; its handle is set once the claim's own read is done. */
interface IClaimState {
  handle?: ISessionClaim;
}

/** The live claims of one store, by id. */
export class SessionClaims {
  readonly #live = new Map<string, IClaimState>();

  has(id: string): boolean {
    return this.#live.has(id);
  }

  /** Throws `claimed` when `id` is claimed already. */
  assertUnclaimed(id: string): void {
    if (this.#live.has(id)) throw new SessionClaimedError(id, 'claimed');
  }

  /**
   * Claims `id`, with `read` as the claim's own read. A `fresh` claim is in place before its read, so
   * the read is answered as a claimed id's is (nothing on disk is taken for a new session); any other
   * claim reads first, as an ordinary hold read, and is in place before anything else can read. A read
   * that throws leaves nothing claimed. The caller checked that `id` is unclaimed.
   */
  open(id: string, fresh: boolean, read: () => TSessionLoadOutcome): ISessionClaim {
    const state: IClaimState = {};
    const end = (): void => {
      if (this.#live.get(id) === state) this.#live.delete(id);
    };
    if (fresh) this.#live.set(id, state);
    let outcome: TSessionLoadOutcome;
    try {
      outcome = read();
    } catch (error) {
      end();
      throw error;
    }
    this.#live.set(id, state);
    let released = false;
    const handle: ISessionClaim = Object.freeze({
      outcome,
      release: (): void => {
        if (released) return;
        released = true;
        end();
      },
    });
    state.handle = handle;
    return handle;
  }

  /**
   * Throws unless a save of `id` under `claim` may go ahead: a claimed id is saved only under its live
   * claim (`claimed` without one), and a claim that is not the id's live one is `released`.
   */
  assertSaveAllowed(id: string, claim: ISessionClaim | undefined): void {
    const live = this.#live.get(id);
    if (claim !== undefined) {
      if (live === undefined || live.handle !== claim)
        throw new SessionClaimedError(id, 'released');
      return;
    }
    if (live !== undefined) throw new SessionClaimedError(id, 'claimed');
  }
}
