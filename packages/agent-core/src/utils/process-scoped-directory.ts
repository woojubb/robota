/**
 * Scratch directories that belong to one process and must not outlive it.
 *
 * A run that promises to leave nothing behind keeps its working data (spilled tool results, edit
 * checkpoint pre-images, an editor buffer) in directories named for the process that owns them, each
 * holding an owner record written before anything else goes in. Removal when the process ends is the
 * job of `removeDirectoryOnProcessExit`; a process that dies without running it (SIGKILL, a power
 * loss) leaves its directory behind, and {@link sweepStaleProcessScopedDirectories} removes it on a
 * later start.
 *
 * ## Why the owner record decides, not age and not the pid alone
 *
 * Age cannot tell a stale directory from a live one: an idle session can go hours without touching
 * its directory, and removing it from under that session breaks the session. The pid alone is not
 * enough either: a recycled pid keeps a dead owner's directory alive, a CLI that always runs as pid 1
 * sees its own pid in every leftover, and two containers sharing a state root each read the other's
 * live pid as dead. The owner record carries the machine (host name and, where readable, machine id),
 * the pid with its start time, the boot and — on Linux — the pid namespace, and a directory is removed
 * only when its owner provably cannot be alive:
 *
 * - it was made on this machine in an earlier boot; or
 * - it was made on this machine in this boot and pid namespace, and its pid is gone or now belongs to
 *   a process with a different start time.
 *
 * Anything else is kept: a directory from another machine or one whose record does not name its
 * machine (a state root shared over a network filesystem or with a container on another kernel holds
 * live directories whose boot differs and whose pid means nothing here, and every Linux machine
 * reports the same initial pid namespace); one from another pid namespace (its owner may be live in
 * another container); one whose owner record is missing or unreadable; and one whose live pid's start
 * time cannot be read. The machine matches only when the host names do and the machine ids do, a
 * machine id only one side could read counting as a mismatch. Where the platform offers no boot,
 * start time or machine id (Windows), the pid alone decides on the host the record names.
 */

import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureOwnerOnlyDirectory, writeOwnerOnlyFile } from './owner-only-store.js';
import { readCurrentProcessIdentity, readProcessStartTime } from './process-identity.js';

import type { IOwnerOnlyDurability } from './owner-only-store.js';
import type { IProcessIdentity } from './process-identity.js';

/** `mkdtemp` appends exactly six characters from this alphabet. */
const RANDOM_SUFFIX = '[A-Za-z0-9]{6}';
/** The owner record every process-scoped directory carries; an owner removing its directory removes it too. */
export const PROCESS_OWNER_RECORD_NAME = '.owner.json';
const MAX_OWNER_RECORD_BYTES = 4096;
const MAX_OWNER_FIELD_LENGTH = 256;

/** What a directory named `prefix` + pid is called before `mkdtemp` adds its random suffix. */
export function processScopedDirectoryPrefix(prefix: string, pid: number = process.pid): string {
  return `${prefix}${pid}-`;
}

/** The owning pid a directory name carries for `prefix`, or `undefined` when it is not one of ours. */
function ownerPid(name: string, prefix: string): number | undefined {
  if (!name.startsWith(prefix)) return undefined;
  const match = new RegExp(`^(\\d{1,10})-${RANDOM_SUFFIX}$`, 'u').exec(name.slice(prefix.length));
  if (match === null) return undefined;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

/** The owner record's optional fields, each a non-empty string when present. */
const OWNER_FIELDS = ['startTime', 'bootId', 'pidNamespace', 'hostname', 'machineId'] as const;

/** The serialized owner record; also what test fixtures write for an owner other than this process. */
export function serializeProcessOwnerRecord(owner: IProcessIdentity): string {
  const record: Record<string, string | number> = { pid: owner.pid };
  for (const key of OWNER_FIELDS) {
    const value = owner[key];
    if (value !== undefined) record[key] = value;
  }
  return JSON.stringify(record);
}

function optionalField(record: Record<string, unknown>, key: string): string | undefined | null {
  const value = record[key];
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_OWNER_FIELD_LENGTH
    ? value
    : null;
}

/** The owner record in `directory`, or undefined when it is missing, a link, oversized or malformed. */
function readOwnerRecord(directory: string): IProcessIdentity | undefined {
  try {
    const path = join(directory, PROCESS_OWNER_RECORD_NAME);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_OWNER_RECORD_BYTES) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
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
  } catch {
    // allow-fallback: an unreadable record means "owner unknown", and an unknown owner is kept.
    return undefined;
  }
}

export interface ICreateProcessScopedDirectoryOptions extends IOwnerOnlyDurability {
  /**
   * `false` when `parent` is a host's existing directory that must be used as it is: it is not
   * created or tightened. By default `parent` is created if missing and made owner-only.
   */
  readonly prepareParent?: boolean;
  /**
   * How this process's start time is read for its owner record; defaults to
   * {@link readProcessStartTime}. A Windows host that can read a process creation time passes its
   * reader here, as it does to the sweep, or the record carries none and only the pid decides.
   */
  readonly readStartTime?: (pid: number) => string | undefined;
  /**
   * Flush the owner record and the directory holding it before returning, so that from then on a
   * crash leaves the directory with its record or without the directory: for one whose owner others
   * must still be able to judge after a power cut, such as a marker they refuse at.
   */
  readonly durable?: boolean;
}

/** This process as its owner record states it, its start time read by `readStartTime` when given. */
function ownerIdentity(readStartTime?: (pid: number) => string | undefined): IProcessIdentity {
  const current = readCurrentProcessIdentity();
  if (readStartTime === undefined) return current;
  const { startTime: _ignored, ...rest } = current;
  const startTime = readStartTime(current.pid);
  return startTime === undefined ? rest : { ...rest, startTime };
}

/**
 * Create an owner-only directory named for this process under `parent`, with its owner record
 * written first.
 *
 * Unless told otherwise, `parent` is created and tightened here, so it must be a directory the host
 * owns for this purpose, never a shared one such as the operating-system temporary directory.
 */
export function createProcessScopedDirectory(
  parent: string,
  prefix: string,
  options: ICreateProcessScopedDirectoryOptions = {},
): string {
  if (options.prepareParent !== false) ensureOwnerOnlyDirectory(parent);
  const directory = mkdtempSync(join(parent, processScopedDirectoryPrefix(prefix)));
  try {
    ensureOwnerOnlyDirectory(directory);
    writeOwnerOnlyFile(
      join(directory, PROCESS_OWNER_RECORD_NAME),
      serializeProcessOwnerRecord(ownerIdentity(options.readStartTime)),
      options.durable === true
        ? {
            durable: true,
            ...(options.syncFile === undefined ? {} : { syncFile: options.syncFile }),
            ...(options.syncDirectory === undefined ? {} : { syncDirectory: options.syncDirectory }),
          }
        : {},
    );
  } catch (error) {
    // A directory without its owner record would never be swept; it must not be left behind.
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

export interface ISweepProcessScopedDirectoriesOptions {
  /** This process. Defaults to the real one; injectable so tests need no real pids, boots or namespaces. */
  readonly current?: IProcessIdentity;
  /** Whether a pid exists in this pid namespace. Defaults to a signal-0 probe. */
  readonly isProcessAlive?: (pid: number) => boolean;
  /** A live pid's start time as the owner record carries it. Defaults to {@link readProcessStartTime}. */
  readonly readStartTime?: (pid: number) => string | undefined;
}

function probeProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists under another account; only ESRCH means it is gone.
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

/** Whether `owner` provably cannot be alive, by the rule the module documentation states. */
function ownerIsGone(
  owner: IProcessIdentity,
  current: IProcessIdentity,
  isAlive: (pid: number) => boolean,
  readStartTime: (pid: number) => string | undefined,
): boolean {
  if (!ownerOnThisMachine(owner, current)) return false;
  if (
    owner.bootId !== undefined &&
    current.bootId !== undefined &&
    owner.bootId !== current.bootId
  ) {
    return true;
  }
  if (owner.pidNamespace !== current.pidNamespace) return false;
  const ownPid = owner.pid === current.pid;
  if (!ownPid && !isAlive(owner.pid)) return true;
  if (owner.startTime === undefined) return false;
  const liveStartTime = ownPid ? current.startTime : readStartTime(owner.pid);
  return liveStartTime !== undefined && liveStartTime !== owner.startTime;
}

/**
 * Whether `owner` is provably running: on this machine, in this pid namespace, with a start time
 * recorded, and its pid alive now with that same start time. A recycled pid fails the start-time
 * comparison; another machine's initial pid namespace carries the same number as this one's.
 */
function ownerIsAlive(
  owner: IProcessIdentity,
  current: IProcessIdentity,
  isAlive: (pid: number) => boolean,
  readStartTime: (pid: number) => string | undefined,
): boolean {
  if (!ownerOnThisMachine(owner, current)) return false;
  if (owner.pidNamespace !== current.pidNamespace || owner.startTime === undefined) return false;
  if (owner.pid === current.pid) return current.startTime === owner.startTime;
  return isAlive(owner.pid) && readStartTime(owner.pid) === owner.startTime;
}

/** A process-scoped directory as found: its owner record, when one names the pid its name carries. */
interface IScopedDirectory {
  readonly name: string;
  readonly path: string;
  readonly pid: number;
  readonly owner: IProcessIdentity | undefined;
}

/**
 * The real directories owned by this account under `parent` whose names have the exact scoped form
 * for `prefix`; a symbolic link, another account's directory, a file and every other name are left
 * out. The owner record is kept only when it names the same pid as the directory's name.
 */
function* scopedDirectories(parent: string, prefix: string): Generator<IScopedDirectory> {
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return; // allow-fallback: no parent yet means nothing was ever created under it.
  }
  for (const name of names) {
    const pid = ownerPid(name, prefix);
    if (pid === undefined) continue;
    const path = join(parent, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      if (process.getuid !== undefined && stat.uid !== process.getuid()) continue;
    } catch {
      continue; // allow-fallback: a directory removed meanwhile is simply not there.
    }
    const record = readOwnerRecord(path);
    yield { name, path, pid, owner: record?.pid === pid ? record : undefined };
  }
}

/** What can be told about the owner of a process-scoped directory. */
export type TProcessOwnerLiveness =
  /** Running: this pid namespace, and its pid alive with the start time the record carries. */
  | 'alive'
  /** Provably not running, by the rule the module documentation states. */
  | 'gone'
  /** Neither can be shown: another pid namespace, no start time recorded or readable, no owner record. */
  | 'unknown';

export interface IProcessScopedDirectoryEntry {
  readonly name: string;
  readonly path: string;
  /** The owning pid the directory's name carries. */
  readonly pid: number;
  /** The owner record; absent when it is missing, unreadable or names another pid. */
  readonly owner?: IProcessIdentity;
  readonly liveness: TProcessOwnerLiveness;
}

/**
 * The directories under `parent` that `createProcessScopedDirectory(parent, prefix)` made, each with
 * whether its owner is alive, gone or unknown. Considers exactly what the sweep considers and removes
 * nothing; a host that must not act while another owner runs reads `alive` and `unknown` as the two
 * different answers they are.
 */
export function inspectProcessScopedDirectories(
  parent: string,
  prefix: string,
  options: ISweepProcessScopedDirectoriesOptions = {},
): readonly IProcessScopedDirectoryEntry[] {
  const isAlive = options.isProcessAlive ?? probeProcess;
  const readStartTime = options.readStartTime ?? ((pid: number) => readProcessStartTime(pid));
  let current = options.current;
  const entries: IProcessScopedDirectoryEntry[] = [];
  for (const { name, path, pid, owner } of scopedDirectories(parent, prefix)) {
    if (owner === undefined) {
      entries.push({ name, path, pid, liveness: 'unknown' });
      continue;
    }
    current ??= readCurrentProcessIdentity();
    let liveness: TProcessOwnerLiveness = 'unknown';
    try {
      if (ownerIsGone(owner, current, isAlive, readStartTime)) liveness = 'gone';
      else if (ownerIsAlive(owner, current, isAlive, readStartTime)) liveness = 'alive';
    } catch {
      // allow-fallback: a probe that failed told nothing, which is exactly `unknown`.
    }
    entries.push({ name, path, pid, owner, liveness });
  }
  return entries;
}

/**
 * Remove the directories under `parent` that `createProcessScopedDirectory(parent, prefix)` made for
 * an owner that can no longer be alive. Returns the names removed.
 *
 * Only a real directory owned by this account whose name has the exact scoped form and whose owner
 * record names the same pid is considered; a symbolic link, another account's directory, a file and
 * every other name are left alone. A directory that cannot be removed is skipped and retried by the
 * next start.
 */
export function sweepStaleProcessScopedDirectories(
  parent: string,
  prefix: string,
  options: ISweepProcessScopedDirectoriesOptions = {},
): readonly string[] {
  const isAlive = options.isProcessAlive ?? probeProcess;
  const readStartTime = options.readStartTime ?? ((pid: number) => readProcessStartTime(pid));
  let current = options.current;
  const removed: string[] = [];
  for (const { name, path, owner } of scopedDirectories(parent, prefix)) {
    if (owner === undefined) continue;
    try {
      current ??= readCurrentProcessIdentity();
      if (!ownerIsGone(owner, current, isAlive, readStartTime)) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // allow-fallback: one directory that cannot be removed must not stop the others or the start.
    }
  }
  return removed;
}
