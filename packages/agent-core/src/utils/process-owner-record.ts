/**
 * The owner record a process leaves where others must later judge whether it still runs, and the
 * one rule they judge it by. Process-scoped directories carry one (`process-scoped-directory.ts`),
 * and so do exclusive markers (`process-marker.ts`), so both answer "is its owner alive" alike.
 *
 * ## Why the owner record decides, not age and not the pid alone
 *
 * Age cannot tell a stale record from a live one: an idle session can go hours without touching
 * what it owns. The pid alone is not enough either: a recycled pid keeps a dead owner's record
 * alive, a CLI that always runs as pid 1 sees its own pid in every leftover, and two containers
 * sharing a state root each read the other's live pid as dead. The record carries the machine (host
 * name and, where readable, machine id), the pid with its start time, the boot and — on Linux — the
 * pid namespace, and an owner is `gone` only when it provably cannot be alive:
 *
 * - it ran on this machine in an earlier boot; or
 * - it ran on this machine in this boot and pid namespace, and its pid is gone or now belongs to a
 *   process with a different start time.
 *
 * It is `alive` only when it ran on this machine, in this pid namespace, with a start time recorded,
 * and its pid is alive now with that same start time. Anything else is `unknown`: an owner on another
 * machine or one whose record does not name its machine (a state root shared over a network
 * filesystem or with a container on another kernel holds live records whose boot differs and whose
 * pid means nothing here, and every Linux machine reports the same initial pid namespace); one from
 * another pid namespace; and one whose live pid's start time cannot be read. The machine matches only
 * when the host names do and the machine ids do, a machine id only one side could read counting as a
 * mismatch. Where the platform offers no boot, start time or machine id (Windows), the pid alone
 * decides `gone`, and a live owner is `unknown`.
 */

import { lstatSync, readFileSync } from 'node:fs';

import { readCurrentProcessIdentity, readProcessStartTime } from './process-identity.js';

import type { IProcessIdentity, TProcessOwnerLiveness } from '../interfaces/process-marker.js';

/** The largest owner record read; anything larger is not one. */
export const MAX_OWNER_RECORD_BYTES = 4096;
const MAX_OWNER_FIELD_LENGTH = 256;

/** The owner record's optional fields, each a non-empty string when present. */
const OWNER_FIELDS = ['startTime', 'bootId', 'pidNamespace', 'hostname', 'machineId'] as const;

/** The owner record's fields as written, which a marker extends with its own. */
export function processOwnerRecordFields(owner: IProcessIdentity): Record<string, string | number> {
  const record: Record<string, string | number> = { pid: owner.pid };
  for (const key of OWNER_FIELDS) {
    const value = owner[key];
    if (value !== undefined) record[key] = value;
  }
  return record;
}

/** The serialized owner record; also what test fixtures write for an owner other than this process. */
export function serializeProcessOwnerRecord(owner: IProcessIdentity): string {
  return JSON.stringify(processOwnerRecordFields(owner));
}

function optionalField(record: Record<string, unknown>, key: string): string | undefined | null {
  const value = record[key];
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_OWNER_FIELD_LENGTH
    ? value
    : null;
}

/** The owner a parsed record names, or undefined when it is not an owner record. */
export function parseProcessOwnerRecord(parsed: unknown): IProcessIdentity | undefined {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const pid = record['pid'];
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const owner: { -readonly [K in keyof IProcessIdentity]: IProcessIdentity[K] } = { pid };
  for (const key of OWNER_FIELDS) {
    const value = optionalField(record, key);
    if (value === null) return undefined;
    if (value !== undefined) owner[key] = value;
  }
  return owner;
}

/** The owner record at `path`, or undefined when it is missing, a link, oversized or malformed. */
export function readProcessOwnerRecordFile(path: string): IProcessIdentity | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_OWNER_RECORD_BYTES) return undefined;
    return parseProcessOwnerRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    // allow-fallback: an unreadable record means "owner unknown", and an unknown owner is kept.
    return undefined;
  }
}

/** How an owner's liveness is probed. Every member is injectable, so tests need no real pids. */
export interface IProcessOwnerProbes {
  /** This process. Defaults to the real one; injectable so tests need no real pids, boots or namespaces. */
  readonly current?: IProcessIdentity;
  /** Whether a pid exists in this pid namespace. Defaults to a signal-0 probe. */
  readonly isProcessAlive?: (pid: number) => boolean;
  /** A live pid's start time as the owner record carries it. Defaults to {@link readProcessStartTime}. */
  readonly readStartTime?: (pid: number) => string | undefined;
}

/** Whether `pid` exists: only ESRCH means it is gone, since EPERM is a process under another account. */
export function probeProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Whether `owner` ran on this machine: the host names are equal and so are the machine ids, where a
 * machine id only one side could read counts as a different machine, since that side may be one.
 */
export function ownerOnThisMachine(owner: IProcessIdentity, current: IProcessIdentity): boolean {
  return (
    owner.hostname !== undefined &&
    owner.hostname === current.hostname &&
    owner.machineId === current.machineId
  );
}

/**
 * Whether `owner` is alive, gone or unknown, by the rule the module documentation states. A probe
 * that throws tells nothing, which is exactly `unknown`.
 */
export function classifyProcessOwner(
  owner: IProcessIdentity,
  probes: IProcessOwnerProbes = {},
): TProcessOwnerLiveness {
  try {
    const current = probes.current ?? readCurrentProcessIdentity();
    if (!ownerOnThisMachine(owner, current)) return 'unknown';
    if (
      owner.bootId !== undefined &&
      current.bootId !== undefined &&
      owner.bootId !== current.bootId
    ) {
      return 'gone';
    }
    if (owner.pidNamespace !== current.pidNamespace) return 'unknown';
    const ownPid = owner.pid === current.pid;
    if (!ownPid && !(probes.isProcessAlive ?? probeProcess)(owner.pid)) return 'gone';
    // A recycled pid fails the start-time comparison; without a start time on either side nothing shows it.
    if (owner.startTime === undefined) return 'unknown';
    const liveStartTime = ownPid
      ? current.startTime
      : (probes.readStartTime ?? ((pid: number) => readProcessStartTime(pid)))(owner.pid);
    if (liveStartTime === undefined) return 'unknown';
    return liveStartTime === owner.startTime ? 'alive' : 'gone';
  } catch {
    // allow-fallback: a probe that failed told nothing, which is exactly `unknown`.
    return 'unknown';
  }
}
