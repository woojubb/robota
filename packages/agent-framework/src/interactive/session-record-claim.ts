/**
 * A running session's claim on its record, and what the session may do while it holds it (#3679
 * step 3e).
 *
 * Sealing needs only the public key, so a record that opens says nothing about who wrote it. A
 * session therefore restores only from the read its claim makes — never from an earlier check that
 * something could have swapped the file after — and gates that read on the outcome itself: a record a
 * store that seals calls unverified is refused unless it is exactly the bytes the owner accepted
 * (`acceptedDigest`). Those bytes are raised to the owner's once, after the session restored from them,
 * and never for a copy (`--fork-session`), whose own new record is the owner's. While it runs, every
 * save of its id carries the claim, and the claim keeps the one account of whether the session may
 * still save it: a save the locked keys stood in the way of is tried again at the unlock, a file
 * something unverifiable changed ends saving the id and the state is saved once as a new record, and a
 * session that ends with either refusal still standing saves that copy then.
 */

import {
  SessionAuthorshipRefusedError,
  assertClaimedOutcomeAccepted,
} from './session-authorship-gate.js';
import {
  SessionDivergedError,
  SessionNoLongerSavedError,
  saveCopyOfDivergedSession,
} from './session-divergence.js';
import { decorateSessionStore } from './session-store-view.js';

import type { ISessionStateForSave } from './interactive-session-persistence.js';
import type { TSessionDivergence } from './session-divergence.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionClaim,
  ISessionSaveOptions,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';
import type { SealedSessionUnreadableError, Session } from '@robota-sdk/agent-session';

/** What the claim asks of the session it belongs to. */
export interface ISessionRecordClaimHost {
  /** The live session and its whole state, for the one copy a session that stops saving writes. */
  readonly snapshot: () =>
    { readonly session: Session; readonly state: ISessionStateForSave } | undefined;
  /** Saves the session's own record again now, best effort: the keys that stood in the way unlocked. */
  readonly retrySave: () => void;
  /** Says what happened, through the session's out-of-turn error path. */
  readonly report: (error: Error) => void;
}

/** The refusal of the claimed id that still stands: none, the locked keys, or a change nobody vouched for. */
type TStandingRefusal = 'none' | 'locked' | 'changed';

/**
 * The claim one `InteractiveSession` holds on the record it runs.
 *
 * A resume claims in the read it restores from; a copy (`--fork-session`) claims its source only for
 * that read and lets it go once copied; the session's own id is claimed (fresh, when new) before its
 * first save. {@link end} ends every claim it holds, once, on every way out of the session.
 */
export class SessionRecordClaim {
  readonly #store: IInteractiveSessionStore;
  readonly #acceptedDigest: string | undefined;
  readonly #host: ISessionRecordClaimHost;
  #claim: ISessionClaim | undefined;
  #claimedId: string | undefined;
  #source: ISessionClaim | undefined;
  /** The accepted bytes to raise once the session restored from them; never for a copy. */
  #toAdopt: { readonly id: string; readonly digest: string } | undefined;
  #ended = false;
  #refusal: TStandingRefusal = 'none';
  /** The copy of a session that stopped saving its id: not needed, written, or failed and owed. */
  #copy: 'none' | 'written' | 'owed' = 'none';
  #stopUnlock: (() => void) | undefined;
  /** Held here so the store may hold it weakly: it lives as long as this claim waits for an unlock. */
  readonly #onUnlock = (): void => {
    if (this.#ended || this.#refusal !== 'locked') return;
    try {
      this.#host.retrySave();
    } catch {
      // allow-fallback: an unlock must reach every listener; a save still refused is reported by the save.
    }
  };

  /** The store every save of this session goes through: a save of the claimed id carries the claim. */
  readonly store: IInteractiveSessionStore;

  private constructor(
    store: IInteractiveSessionStore,
    acceptedDigest: string | undefined,
    host: ISessionRecordClaimHost,
  ) {
    // Fail closed: a store that cannot claim cannot gate what the session restores from.
    if (typeof store.claim !== 'function') {
      throw new TypeError('A session store must offer claim: every session claims its record.');
    }
    this.#store = store;
    this.#acceptedDigest = acceptedDigest;
    this.#host = host;
    const saveRestoreTransaction = store.saveRestoreTransaction?.bind(store);
    this.store = decorateSessionStore(store, {
      save: (record: IInteractiveSessionRecord, options?: ISessionSaveOptions): void => {
        const claimed = this.#saveOptionsFor(record.id);
        if (claimed === undefined) {
          if (options === undefined) store.save(record);
          else store.save(record, options);
          return;
        }
        store.save(record, { ...options, ...claimed });
      },
      ...(saveRestoreTransaction
        ? {
            saveRestoreTransaction: (
              record: IInteractiveSessionRecord,
              options?: ISessionSaveOptions,
            ) => {
              const claimed = this.#saveOptionsFor(record.id);
              if (claimed?.claim === undefined) {
                throw new TypeError('A live session claim is required for restore commit.');
              }
              return saveRestoreTransaction(record, { ...options, ...claimed });
            },
          }
        : {}),
    });
  }

  /** The claim of a session over `store`; `undefined` for a session that persists nothing. */
  static over(
    store: IInteractiveSessionStore | undefined,
    acceptedDigest: string | undefined,
    host: ISessionRecordClaimHost,
  ): SessionRecordClaim | undefined {
    return store === undefined ? undefined : new SessionRecordClaim(store, acceptedDigest, host);
  }

  /** Whether the session may still save its id: it has not ended, and nothing unverifiable changed the file. */
  canSave(): boolean {
    return !this.#ended && this.#refusal !== 'changed';
  }

  /** Whether goals, loops and schedules may start something new: only while the session can save. */
  canStartAutonomousWork(): boolean {
    return this.canSave();
  }

  /** The refusal a durable save of `sessionId` meets now, or `undefined` while the session can save. */
  noLongerSaved(sessionId: string): SessionNoLongerSavedError | undefined {
    if (this.#ended) return new SessionNoLongerSavedError(sessionId, 'ended');
    return this.#refusal === 'changed'
      ? new SessionNoLongerSavedError(sessionId, 'diverged')
      : undefined;
  }

  /** Whether this session holds a live claim on `id`. */
  holds(id: string): boolean {
    return !this.#ended && this.#claim !== undefined && this.#claimedId === id;
  }

  /**
   * Claims `id` and returns the outcome the session restores from, gated: a record a store that seals
   * calls unverified is refused unless it is the accepted bytes, and the claim let go. A `copy` keeps
   * the claim only until {@link copied}, takes no writer marker, and never raises what it copies.
   */
  readForRestore(id: string, copy: boolean): TSessionLoadOutcome {
    // A copy reads what was last saved and takes no writer marker, so a session another process runs
    // can still be copied; its own new id is claimed fresh before its first save.
    const claim = this.#store.claim(id, copy ? { copy: true } : undefined);
    try {
      assertClaimedOutcomeAccepted(id, claim.outcome, this.#acceptedDigest);
    } catch (error) {
      claim.release();
      throw error;
    }
    const outcome = claim.outcome;
    if (copy) {
      this.#source = claim;
      return outcome;
    }
    this.#claim = claim;
    this.#claimedId = id;
    if (outcome.status === 'valid' && outcome.authorship === 'unverified' && outcome.digest) {
      this.#toAdopt = { id, digest: outcome.digest };
    }
    return outcome;
  }

  /**
   * The session restored from the claimed record: accepted bytes are raised to the owner's now, once.
   * Throws when the store will not raise them — they changed, or another writer holds them — so the
   * session never runs a record it could not make the owner's.
   */
  restored(): void {
    const accepted = this.#toAdopt;
    this.#toAdopt = undefined;
    const authorship = this.#store.authorship;
    // A view of the store without the member loses the raise, never the gate.
    if (accepted === undefined || authorship === undefined) return;
    const result = authorship.adopt(accepted.id, accepted.digest);
    if (result === 'adopted' || result === 'pending') return;
    throw new SessionAuthorshipRefusedError(
      accepted.id,
      result === 'has_writer' ? 'has_writer' : 'changed-since-accepted',
    );
  }

  /** The copied source is no longer needed: its claim ends, so the source can run elsewhere. */
  copied(): void {
    this.#source?.release();
    this.#source = undefined;
  }

  /**
   * Claims the session's own id before its first save: a new session claims fresh, a resumed one
   * already holds it. Nothing is claimed once the session has ended.
   */
  claimSession(id: string): void {
    if (this.#ended || this.#claimedId === id) return;
    const claim = this.#store.claim(id, { fresh: true });
    // A session saves one id; a claim read for another one (an injected session) is let go.
    this.#claim?.release();
    this.#claim = claim;
    this.#claimedId = id;
  }

  /**
   * Refuses a new turn of a session that no longer saves its id, and first tries again a save the
   * locked keys refused, so a turn that could not be recorded is not started; `checkpoint` is skipped
   * while a turn is still running, which records itself.
   */
  admitTurn(sessionId: string, checkpoint: (() => void) | undefined): void {
    const refusal = this.noLongerSaved(sessionId);
    if (refusal !== undefined) throw refusal;
    if (this.#refusal !== 'locked' || checkpoint === undefined) return;
    try {
      checkpoint();
    } catch (error) {
      throw this.noLongerSaved(sessionId) ?? error;
    }
  }

  /**
   * A save the store refused. Returns whether the claim said it in its own words: a file something
   * unverifiable changed ends saving the id and saves the state as a new record. A refusal only the
   * locked keys stand behind waits for the unlock, and is reported by the caller as the store worded it.
   */
  refused(error: SealedSessionUnreadableError): boolean {
    if (!this.holds(error.sessionId)) return false;
    if (error.reason === 'changed') {
      this.#stopWaitingForUnlock();
      if (this.#refusal !== 'changed') {
        this.#refusal = 'changed';
        this.#saveCopy(error.sessionId, 'changed', false);
      }
      return true;
    }
    if (error.reason === 'locked' && this.#refusal === 'none') {
      this.#refusal = 'locked';
      this.#stopUnlock = this.#store.authorship?.onUnlock(this.#onUnlock);
    }
    return false;
  }

  /** A save of `id` went through: a refusal the locked keys stood behind no longer stands. */
  saved(id: string): void {
    if (!this.holds(id) || this.#refusal !== 'locked') return;
    this.#refusal = 'none';
    this.#stopWaitingForUnlock();
  }

  /**
   * Ends every claim the session holds. Idempotent. A session that ends while a refusal of its id still
   * stands saves its state as a new record first — no unlock will come for it now — and a copy that
   * failed earlier is tried once more.
   */
  end(): void {
    if (this.#ended) return;
    const id = this.#claimedId;
    if (id !== undefined && this.#claim !== undefined) {
      if (this.#refusal === 'locked') this.#saveCopy(id, 'locked', true);
      else if (this.#refusal === 'changed' && this.#copy === 'owed') {
        this.#saveCopy(id, 'changed', true);
      }
    }
    this.#ended = true;
    this.#stopWaitingForUnlock();
    this.#source?.release();
    this.#source = undefined;
    this.#claim?.release();
  }

  /** What a save of `id` carries: the claim, and that the content is the owner's, for its own id only. */
  #saveOptionsFor(id: string): ISessionSaveOptions | undefined {
    if (!this.holds(id)) return undefined;
    // The session restored only what its gate let in, so what it saves under its claim is the owner's.
    return { claim: this.#claim as ISessionClaim, provenance: 'owner' };
  }

  #stopWaitingForUnlock(): void {
    this.#stopUnlock?.();
    this.#stopUnlock = undefined;
  }

  /**
   * Writes the session's state once as a new record, and says so. A copy that fails is reported with
   * the store's own error and owed: it is tried again when the session ends (`last` is that try).
   */
  #saveCopy(sessionId: string, why: TSessionDivergence, last: boolean): void {
    const snapshot = this.#host.snapshot();
    if (snapshot === undefined) return;
    try {
      const copyId = saveCopyOfDivergedSession({ store: this.store, sessionId, ...snapshot });
      this.#copy = 'written';
      this.#host.report(new SessionDivergedError(sessionId, why, copyId));
    } catch (error) {
      this.#copy = 'owed';
      this.#host.report(new SessionDivergedError(sessionId, why, last ? 'failed' : 'retry-at-end'));
      this.#host.report(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
