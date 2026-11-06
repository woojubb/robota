/**
 * An exclusive marker one process holds on a name, seen alike by every process that shares the
 * place the markers are kept: the port a store takes so that one session record has one writer
 * across processes, not only within one.
 *
 * A marker names the process that published it (its owner record) and, for a lent marker, the digest
 * of a lease nonce. A marker whose owner is running or cannot be told running stands, and a second
 * publisher is refused with that owner; one whose owner is provably gone may be broken and taken.
 * The marker is a coordination device: any program running as the same user can plant or remove one,
 * so it guards against two writers of the owner's own, never against such a program.
 *
 * The contract lives here, in the platform-neutral foundation, so a store takes it as an injected
 * port; the file implementation is on the Node entry (`createProcessMarkers`).
 */

/** A process as an observer can later recognize it, on its own machine or one sharing its files. */
export interface IProcessIdentity {
  readonly pid: number;
  /** The process start time as the platform's reader reads it; absent when unreadable. */
  readonly startTime?: string;
  /** The machine boot the process runs in; absent where the platform offers none. */
  readonly bootId?: string;
  /** The Linux pid namespace the pid belongs to; absent elsewhere. */
  readonly pidNamespace?: string;
  /** The host name of the machine the process runs on; absent when it reads empty. */
  readonly hostname?: string;
  /** The machine identifier, as a keyed hash; absent where unreadable or not offered. */
  readonly machineId?: string;
}

/** What can be told about the owner a record names. */
export type TProcessOwnerLiveness =
  /** Running: this pid namespace, and its pid alive with the start time the record carries. */
  | 'alive'
  /** Provably not running: an earlier boot, or its pid gone or reused here. */
  | 'gone'
  /** Neither can be shown: another machine or pid namespace, no start time recorded or readable, no record. */
  | 'unknown';

/** Who holds a standing marker, as far as this process can tell. */
export interface IProcessMarkerHolder {
  /** The owner the marker names; absent when the marker cannot be read as an owner record. */
  readonly owner?: IProcessIdentity;
  /**
   * This process published the marker, as it remembers, never judged from the record: on a platform
   * that reads no start time a live owner, this process included, is `unknown` by its record alone.
   */
  readonly self: boolean;
  /** Whether the owner is running; `alive` for a marker this process holds. */
  readonly liveness: TProcessOwnerLiveness;
}

/** A cooperative OS-backed lock on one name in a marker directory. */
export interface IProcessMarkerOperationLock {
  /** Returns a held lock, or undefined when another process owns it. */
  tryAcquire(name: string): { release(): void } | undefined;
}

/** A guarded marker operation either ran, lost its marker, or could not acquire the guard. */
export type TProcessMarkerGuardResult<T> =
  | { readonly status: 'ran'; readonly value: T }
  | { readonly status: 'lost' }
  | { readonly status: 'busy' };

/** A marker this process published or took over. */
export interface IProcessMarkerHandle {
  /**
   * Whether the marker at the path is still the one this handle published: the same file, and the
   * same lease digest for a lent marker. This is a snapshot; a mutation must use `withGuard` to keep its check and write together.
   */
  holds(): boolean;
  /** Run a synchronous mutation under the same operation lock as marker transitions. */
  withGuard<T>(operation: () => T): TProcessMarkerGuardResult<T>;
  /** Removes the marker, only while it is still this handle's own. Idempotent, and never throws. */
  release(): void;
}

/** How a marker is published. */
export interface IProcessMarkerAcquireOptions {
  /**
   * The SHA-256 (lowercase hex) of a lease nonce the marker carries, so the process given the nonce
   * can take the marker over ({@link IProcessMarkers.takeOver}) and the lender can end it.
   */
  readonly leaseDigest?: string;
}

/** What an acquire did. */
export type TProcessMarkerAcquireResult =
  | { readonly status: 'acquired'; readonly handle: IProcessMarkerHandle }
  /** A marker stands whose owner is running or cannot be told running (or this process's own). */
  | { readonly status: 'held'; readonly holder: IProcessMarkerHolder };

/** What a take-over did. */
export type TProcessMarkerTakeOverResult =
  | { readonly status: 'acquired'; readonly handle: IProcessMarkerHandle }
  /** The marker that stands does not carry the lease the nonce names. */
  | { readonly status: 'held'; readonly holder: IProcessMarkerHolder }
  /** No marker stands: the lease ended, or was never given. */
  | { readonly status: 'absent' };

/** What stands at a name now. */
export type TProcessMarkerState =
  | { readonly status: 'absent' }
  | { readonly status: 'held'; readonly holder: IProcessMarkerHolder };

/** What a removal did. */
export type TProcessMarkerRemoveResult =
  | { readonly status: 'removed'; readonly holder: IProcessMarkerHolder }
  | { readonly status: 'absent' }
  /** Not removed: its owner is not gone and the removal was not forced. */
  | { readonly status: 'held'; readonly holder: IProcessMarkerHolder }
  /** Another process is changing the marker right now; trying again works. */
  | { readonly status: 'busy' };

/** How a removal is meant. */
export interface IProcessMarkerRemoveOptions {
  /**
   * Remove whatever marker stands, a live owner's included, which then loses its fence. Confirming
   * that this is meant is the caller's job.
   */
  readonly force?: boolean;
}

/** The markers kept in one place, by name. */
export interface IProcessMarkers {
  /** Publishes the marker `name`, breaking one whose owner is gone first; refused while another stands. */
  acquire(name: string, options?: IProcessMarkerAcquireOptions): TProcessMarkerAcquireResult;
  /**
   * Takes over the lent marker `name` by presenting the lease `nonce`: only when the SHA-256 of the
   * nonce is the digest the marker carries. The marker then names this process and keeps the digest.
   */
  takeOver(name: string, nonce: string): TProcessMarkerTakeOverResult;
  /**
   * Removes the marker `name` when it carries `leaseDigest`, whether it still names the lender or the
   * process that took it over. Returns whether one was removed; nothing else is touched.
   */
  endLease(name: string, leaseDigest: string): boolean;
  /** What stands at `name` now. */
  inspect(name: string): TProcessMarkerState;
  /** Removes the marker `name`: only one whose owner is gone, unless `force`. */
  remove(name: string, options?: IProcessMarkerRemoveOptions): TProcessMarkerRemoveResult;
}
