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
 * A directory is removed only when its owner record says its owner is `gone`, by the rule
 * `process-owner-record.ts` states, which exclusive markers judge their owners by too.
 */

import { lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ensureOwnerOnlyDirectory, writeOwnerOnlyFile } from './owner-only-store.js';
import {
  classifyProcessOwner,
  readProcessOwnerRecordFile,
  serializeProcessOwnerRecord,
} from './process-owner-record.js';
import { readCurrentProcessIdentity } from './process-identity.js';

import type { IOwnerOnlyDurability } from './owner-only-store.js';
import type { IProcessOwnerProbes } from './process-owner-record.js';
import type { IProcessIdentity, TProcessOwnerLiveness } from '../interfaces/process-marker.js';

/** `mkdtemp` appends exactly six characters from this alphabet. */
const RANDOM_SUFFIX = '[A-Za-z0-9]{6}';
/** The owner record every process-scoped directory carries; an owner removing its directory removes it too. */
export const PROCESS_OWNER_RECORD_NAME = '.owner.json';

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

/** The owner record in `directory`, or undefined when it is missing, a link, oversized or malformed. */
function readOwnerRecord(directory: string): IProcessIdentity | undefined {
  return readProcessOwnerRecordFile(join(directory, PROCESS_OWNER_RECORD_NAME));
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
            ...(options.syncDirectory === undefined
              ? {}
              : { syncDirectory: options.syncDirectory }),
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

/** How a sweep or an inspection probes owners; see {@link IProcessOwnerProbes}. */
export type ISweepProcessScopedDirectoriesOptions = IProcessOwnerProbes;

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

export type { TProcessOwnerLiveness };

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
  let current = options.current;
  const entries: IProcessScopedDirectoryEntry[] = [];
  for (const { name, path, pid, owner } of scopedDirectories(parent, prefix)) {
    if (owner === undefined) {
      entries.push({ name, path, pid, liveness: 'unknown' });
      continue;
    }
    current ??= readCurrentProcessIdentity();
    const liveness = classifyProcessOwner(owner, { ...options, current });
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
  let current = options.current;
  const removed: string[] = [];
  for (const { name, path, owner } of scopedDirectories(parent, prefix)) {
    if (owner === undefined) continue;
    try {
      current ??= readCurrentProcessIdentity();
      if (classifyProcessOwner(owner, { ...options, current }) !== 'gone') continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(name);
    } catch {
      // allow-fallback: one directory that cannot be removed must not stop the others or the start.
    }
  }
  return removed;
}
