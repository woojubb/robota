/**
 * Claims and lends of session ids: the ids a session in this process runs or hands to another
 * process, and the refusal a second writer meets.
 *
 * A claim is exclusive across every process and store instance over the same files, because each
 * one holds the id's writer marker (`IProcessMarkers`, kept in `claims/` beside the records); within
 * one store it is also kept here, released by its own handle only, and it fences saves: a save of a
 * claimed id must carry the live claim, and one carrying a claim that has ended, or whose marker is no
 * longer its own, is refused, so a session that outlived its claim (a shutdown that timed out, a
 * marker another process broke) cannot overwrite the writer that holds the id after it. A lend
 * publishes the marker with a lease digest for another process to take over, and counts as a writer
 * here until it ends. Every store keeps them, sealing or not, so no store lets a session run
 * unclaimed.
 */

import type {
  IProcessMarkerHandle,
  IProcessMarkerHolder,
  TProcessOwnerLiveness,
} from '@robota-sdk/agent-core';
import type { ISessionClaim, TSessionLoadOutcome } from '@robota-sdk/agent-interface-session';

/** Why a claim, a lend or a write was refused. */
export type TSessionClaimRefusal =
  /**
   * Another writer holds the id: a session of this or another store instance, a process it is lent
   * to, or another process. The refusal names who, as far as it can tell.
   */
  | 'has_writer'
  /**
   * What it was done under has ended: a save under a claim that is not the id's live one (it ended,
   * it is another id's, or its marker is no longer its own), or a claim under a lease that ended.
   */
  | 'released';

/** Who holds a session's writer marker, as a refusal names it. */
export interface ISessionWriterHolder {
  readonly pid?: number;
  readonly hostname?: string;
  /** The holder's start time, where the platform reads one. */
  readonly startTime?: string;
  /** This process holds it: a session running or closing here, or a lend not yet taken over. */
  readonly self: boolean;
  readonly liveness: TProcessOwnerLiveness;
}

/** How a store words its refusals: the command that releases a marker whose holder is not running. */
export interface ISessionClaimRefusalWords {
  readonly releaseCommand?: (sessionId: string) => string;
}

/** What a refusal carries beside its reason. */
export interface ISessionClaimRefusalDetails extends ISessionClaimRefusalWords {
  readonly holder?: ISessionWriterHolder;
  /** A `released` refusal of a claim under a lease, not of a save. */
  readonly lease?: true;
}

/** The holder this process is, for a refusal of an id it claims or lends itself. */
export function selfWriterHolder(): ISessionWriterHolder {
  return { pid: process.pid, self: true, liveness: 'alive' };
}

/** A marker's holder as a refusal names it. */
export function writerHolderOf(holder: IProcessMarkerHolder): ISessionWriterHolder {
  const owner = holder.owner;
  return {
    ...(owner === undefined ? {} : { pid: owner.pid }),
    ...(owner?.hostname === undefined ? {} : { hostname: owner.hostname }),
    ...(owner?.startTime === undefined ? {} : { startTime: owner.startTime }),
    self: holder.self,
    liveness: holder.liveness,
  };
}

function holderText(holder: ISessionWriterHolder): string {
  const parts = [holder.pid === undefined ? 'a process this one cannot read' : `pid ${holder.pid}`];
  if (holder.hostname !== undefined) parts.push(`on ${holder.hostname}`);
  if (holder.startTime !== undefined) parts.push(`started ${holder.startTime}`);
  return parts.join(' ');
}

function hasWriterMessage(sessionId: string, details: ISessionClaimRefusalDetails): string {
  const holder = details.holder ?? selfWriterHolder();
  if (holder.self) {
    return (
      `Session ${sessionId} is already open in this process (pid ${process.pid}): a session ` +
      'running or still closing here, or a subagent it is handed to. Try again once that has ended.'
    );
  }
  const release = details.releaseCommand?.(sessionId);
  if (holder.liveness === 'gone') {
    return (
      `Session ${sessionId} is held by a process that is no longer running (${holderText(holder)}), ` +
      `and another process is releasing it now. Try again${release === undefined ? '' : `, or run: ${release}`}.`
    );
  }
  const where =
    holder.liveness === 'alive' ? 'is open in another process' : 'may be open in another process';
  let message =
    `Session ${sessionId} ${where} (${holderText(holder)}), which writes it; close it there first.` +
    (release === undefined
      ? ''
      : ` If that process is no longer running, release the session with: ${release}`);
  // Windows reads no start time, so a pid reused after a crash keeps the marker standing.
  if (process.platform === 'win32') {
    message += ' On Windows, a process that crashed may still be shown as holding it.';
  }
  return message;
}

function claimRefusalMessage(
  sessionId: string,
  reason: TSessionClaimRefusal,
  details: ISessionClaimRefusalDetails,
): string {
  switch (reason) {
    case 'has_writer':
      return hasWriterMessage(sessionId, details);
    case 'released':
      return details.lease === true
        ? `Session ${sessionId} was not opened: the lease it was handed over with has ended.`
        : `Session ${sessionId} was not saved: the claim it was saved under has ended or no longer ` +
            'holds its writer marker.';
  }
}

/** A claim, a lend or a write the store refused. Fixed text, the session id and the holder only. */
export class SessionClaimedError extends Error {
  readonly code = 'SESSION_CLAIMED' as const;
  readonly sessionId: string;
  readonly reason: TSessionClaimRefusal;
  /** Who holds the id, for a `has_writer` refusal. */
  readonly holder: ISessionWriterHolder | undefined;

  constructor(
    sessionId: string,
    reason: TSessionClaimRefusal,
    details: ISessionClaimRefusalDetails = {},
  ) {
    super(claimRefusalMessage(sessionId, reason, details));
    this.name = 'SessionClaimedError';
    this.sessionId = sessionId;
    this.reason = reason;
    this.holder = reason === 'has_writer' ? (details.holder ?? selfWriterHolder()) : undefined;
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

/** One live claim: its handle once the claim's own read is done, and its writer marker. */
interface IClaimState {
  handle?: ISessionClaim;
  /** Absent for a copy's read, which takes no marker. */
  readonly marker: IProcessMarkerHandle | undefined;
}

/** The live claims and lends of one store, by id. */
export class SessionClaims {
  readonly #live = new Map<string, IClaimState>();
  readonly #lent = new Map<string, object>();
  readonly #words: ISessionClaimRefusalWords;

  constructor(words: ISessionClaimRefusalWords = {}) {
    this.#words = words;
  }

  /** Whether `id` is claimed in this store. */
  has(id: string): boolean {
    return this.#live.has(id);
  }

  /** Whether `id` is lent from this store. */
  isLent(id: string): boolean {
    return this.#lent.has(id);
  }

  /** A refusal in this store's words. */
  refusal(
    id: string,
    reason: TSessionClaimRefusal,
    details: Omit<ISessionClaimRefusalDetails, 'releaseCommand'> = {},
  ): SessionClaimedError {
    return new SessionClaimedError(id, reason, { ...this.#words, ...details });
  }

  /** Throws `has_writer` when `id` is claimed or lent in this store already. */
  assertUnclaimed(id: string): void {
    if (this.#live.has(id) || this.#lent.has(id)) throw this.refusal(id, 'has_writer');
  }

  /**
   * Claims `id` holding `marker`, with `read` as the claim's own read. A `fresh` claim is in place
   * before its read, so the read is answered as a claimed id's is (nothing on disk is taken for a new
   * session); any other claim reads first, as an ordinary hold read, and is in place before anything
   * else can read. A read that throws leaves nothing claimed and releases the marker. The caller
   * checked that `id` is unclaimed.
   */
  open(
    id: string,
    fresh: boolean,
    marker: IProcessMarkerHandle | undefined,
    read: () => TSessionLoadOutcome,
  ): ISessionClaim {
    const state: IClaimState = { marker };
    const end = (): void => {
      if (this.#live.get(id) === state) this.#live.delete(id);
      marker?.release();
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
   * The writer marker a save of `id` holds, after the checks a save must pass: a claimed or lent id is
   * saved only under its live claim (`has_writer` without one), a claim that is not the id's live one
   * is `released`, and so is one whose marker another process took. `undefined` for an id this store
   * does not claim, and for a claim that took no marker (a copy's read): the save takes one itself.
   */
  markerForSave(id: string, claim: ISessionClaim | undefined): IProcessMarkerHandle | undefined {
    const live = this.#live.get(id);
    if (claim !== undefined) {
      if (live === undefined || live.handle !== claim) throw this.refusal(id, 'released');
      if (live.marker !== undefined && !live.marker.holds()) throw this.refusal(id, 'released');
      return live.marker;
    }
    if (live !== undefined || this.#lent.has(id)) throw this.refusal(id, 'has_writer');
    return undefined;
  }

  /**
   * The marker a write of `id` that carries no claim (an adopt, a tag at unlock) holds when this store
   * claims the id: the live claim's, while it is still its own. `has_writer` for an id this store lent
   * or whose claim lost its marker; `undefined` for an id this store does not claim.
   */
  markerForWrite(id: string): IProcessMarkerHandle | undefined {
    if (this.#lent.has(id)) throw this.refusal(id, 'has_writer');
    const live = this.#live.get(id);
    if (live === undefined) return undefined;
    if (live.marker === undefined || !live.marker.holds()) throw this.refusal(id, 'has_writer');
    return live.marker;
  }

  /** Records `id` as lent until the returned end runs; the caller checked that it is unclaimed. */
  lend(id: string): () => void {
    const token = {};
    this.#lent.set(id, token);
    return () => {
      if (this.#lent.get(id) === token) this.#lent.delete(id);
    };
  }
}
