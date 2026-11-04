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
 * here until it ends; a refusal of a lent id names the process it went to once that took the marker
 * over, and says a subagent this process started holds it before. Every store keeps them, sealing or
 * not, so no store lets a session run unclaimed.
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
  /** This process holds it: a session of this store running or closing here, or a lend not yet taken over. */
  readonly self: boolean;
  readonly liveness: TProcessOwnerLiveness;
  /** The id is lent: the holder is the subagent this process started, or this process until it takes over. */
  readonly lent?: true;
}

/** How a store words its refusals: the command that releases a marker whose holder is not running. */
export interface ISessionClaimRefusalWords {
  readonly releaseCommand?: (sessionId: string) => string;
}

/**
 * The process a store runs in, as a refusal names it: the Node store states it, because this module
 * is neutral and reads no process. A refusal from a store with none names no pid and adds no
 * platform sentence.
 */
export interface ISessionClaimProcess {
  readonly pid: number;
  /** Windows reads no start time, so a holder that crashed may still be shown as holding the id. */
  readonly windows: boolean;
}

/** What a refusal carries beside its reason. */
export interface ISessionClaimRefusalDetails extends ISessionClaimRefusalWords {
  readonly holder?: ISessionWriterHolder;
  /** A `released` refusal of a claim under a lease, not of a save. */
  readonly lease?: true;
  /** The process the refusing store runs in. */
  readonly ownProcess?: ISessionClaimProcess;
}

/** The holder this process is, for a refusal of an id it claims or lends itself. */
function selfWriterHolder(ownProcess: ISessionClaimProcess | undefined): ISessionWriterHolder {
  return {
    ...(ownProcess === undefined ? {} : { pid: ownProcess.pid }),
    self: true,
    liveness: 'alive',
  };
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
  const holder = details.holder ?? selfWriterHolder(details.ownProcess);
  if (holder.lent === true) {
    // The lend ends when the subagent has exited, so nothing here is released by hand.
    return holder.self
      ? `Session ${sessionId} is lent to a subagent this process started, which has not taken it up ` +
          'yet; try again once that subagent has finished.'
      : `Session ${sessionId} is lent to a subagent this process started (${holderText(holder)}), ` +
          'which writes it; try again once that subagent has finished.';
  }
  if (holder.self) {
    const pid = details.ownProcess === undefined ? '' : ` (pid ${details.ownProcess.pid})`;
    return (
      `Session ${sessionId} is already open in this process${pid}: a session ` +
      'running or still closing here. Try again once that has ended.'
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
  if (details.ownProcess?.windows === true) {
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
  /**
   * A session of this process holds the id and has not let its claim go, so a caller may try again
   * once it has. Not so for a lend, which runs until its subagent has exited, nor for another process.
   */
  readonly closing: boolean;

  constructor(
    sessionId: string,
    reason: TSessionClaimRefusal,
    details: ISessionClaimRefusalDetails = {},
  ) {
    super(claimRefusalMessage(sessionId, reason, details));
    this.name = 'SessionClaimedError';
    this.sessionId = sessionId;
    this.reason = reason;
    this.holder =
      reason === 'has_writer'
        ? (details.holder ?? selfWriterHolder(details.ownProcess))
        : undefined;
    this.closing = this.holder?.self === true && this.holder.lent !== true;
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

/** One lend: the id's marker's holder now, which is the subagent once it took the marker over. */
interface ILend {
  readonly holder: () => IProcessMarkerHolder | undefined;
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
  readonly #lent = new Map<string, ILend>();
  readonly #words: ISessionClaimRefusalWords;
  readonly #ownProcess: ISessionClaimProcess | undefined;

  constructor(words: ISessionClaimRefusalWords = {}, ownProcess?: ISessionClaimProcess) {
    this.#words = words;
    this.#ownProcess = ownProcess;
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
    return new SessionClaimedError(id, reason, {
      ...this.#words,
      ...(this.#ownProcess === undefined ? {} : { ownProcess: this.#ownProcess }),
      ...details,
    });
  }

  /** Throws `has_writer` when `id` is claimed or lent in this store already. */
  assertUnclaimed(id: string): void {
    if (this.#live.has(id) || this.#lent.has(id)) throw this.#heldRefusal(id);
  }

  /**
   * `has_writer` for an id this store claims or lends. A claim is a session of this process, running
   * or closing; a lend names the process it went to once that took the marker over, and says a
   * subagent this process started holds it before.
   */
  #heldRefusal(id: string): SessionClaimedError {
    const lend = this.#lent.get(id);
    if (lend === undefined) return this.refusal(id, 'has_writer');
    const marker = lend.holder();
    const holder =
      marker === undefined || marker.self
        ? selfWriterHolder(this.#ownProcess)
        : writerHolderOf(marker);
    return this.refusal(id, 'has_writer', { holder: { ...holder, lent: true } });
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
    if (live !== undefined || this.#lent.has(id)) throw this.#heldRefusal(id);
    return undefined;
  }

  /**
   * The marker a write of `id` that carries no claim (an adopt, a tag at unlock) holds when this store
   * claims the id: the live claim's, while it is still its own. `has_writer` for an id this store lent
   * or whose claim lost its marker; `undefined` for an id this store does not claim.
   */
  markerForWrite(id: string): IProcessMarkerHandle | undefined {
    if (this.#lent.has(id)) throw this.#heldRefusal(id);
    const live = this.#live.get(id);
    if (live === undefined) return undefined;
    if (live.marker === undefined || !live.marker.holds()) throw this.refusal(id, 'has_writer');
    return live.marker;
  }

  /**
   * Records `id` as lent until the returned end runs; the caller checked that it is unclaimed.
   * `holder` reads the id's marker, which a refusal of the lent id names.
   */
  lend(id: string, holder: () => IProcessMarkerHolder | undefined): () => void {
    const lend: ILend = { holder };
    this.#lent.set(id, lend);
    return () => {
      if (this.#lent.get(id) === lend) this.#lent.delete(id);
    };
  }
}
