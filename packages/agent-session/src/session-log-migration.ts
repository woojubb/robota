/**
 * Sealing in place the session logs a host-filesystem sink (`NodeSessionLogSink`) wrote in plaintext,
 * for a host migrating its state once it seals (#3679): every `<id>.jsonl` in one directory, with its
 * `<id>.payloads/` sidecars.
 *
 * - A log becomes one sealed record per non-empty plain line, its sealed lines kept as they are and
 *   its empty lines dropped, so a stored-record offset (`/agent read`) names the same line after.
 * - A sidecar is sealed in place under its existing name: a source opens sealed bytes whatever the
 *   name, and the digest and length a reference checks are the plaintext's, so no reference — nested
 *   ones inside other payloads included — changes. A migrated sidecar keeps its content-derived name.
 * - Order: every sidecar of a session sealed beside it and flushed, then each put in place (atomic,
 *   made only while the file still holds what was read), then its log, which is the commit. A log is
 *   rewritten as the prompt history is compacted (`append-file-rewrite.ts`), so a line a writer
 *   appends meanwhile is caught up; a plain line that still reaches it afterwards, a log another
 *   rewrite replaced first, or a plain sidecar that appears, is reported for a rerun, and a catch-up
 *   that failed with how much it left unread. A log deleted meanwhile stays deleted, and uncounted.
 *
 * Whether something is done is decided by whether it opens for its session, never by framing alone; a
 * sealed sidecar that does not open here is left as it is and reported. Links, anything that is not a
 * regular file or directory, and a file with another hard link (replacing it would leave the
 * plaintext under the other name) are never followed or touched.
 */
import { closeSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { openAppendFile, readWhole, rewriteAppendFile } from './append-file-rewrite.js';
import { isSafeSessionId } from './session-id.js';
import { sweepStaleStoreTemporaries } from './stale-temporaries.js';
import { readRegularFile, replaceStagedFiles } from './staged-replacements.js';
import {
  SessionLogLineSealer,
  countPlainSessionLogLines,
  sealStoredPayloadBytes,
  storedPayloadMigrationState,
} from './stored-append-lines.js';

import type { IAppendFileCatchUpFailure } from './append-file-rewrite.js';
import type { IArtifactSealer } from '@robota-sdk/agent-core';

const LOG_EXTENSION = '.jsonl';
const PAYLOAD_DIRECTORY_SUFFIX = '.payloads';
const TEMPORARY_SUFFIX = '.tmp';

export interface IMigrateSessionLogsOptions {
  /** Seals what is plain and opens what is sealed; the keys must be unlocked. */
  readonly sealer: IArtifactSealer;
  /** `false` plans: everything is read and counted exactly as a run would, and nothing is written. */
  readonly apply: boolean;
  /** An ancestor of the directory the host also owns, tightened along with it (SEC-020). */
  readonly ownedRoot?: string;
  /** Runs before each sidecar replace and each log replace; throwing stops the migration there. */
  readonly beforeCommit?: () => void;
  /** Waits between catch-up passes over a replaced log; defaults to a short timer. */
  readonly pause?: () => Promise<void>;
  /**
   * Also removes the temp files crashed writes left; leave it off while another writer may be running.
   * Off, they are still counted in `staleTemporaries` and left where they are.
   */
  readonly sweepTemporaries?: boolean;
  /**
   * When the migration started, in milliseconds by the filesystem's clock (its marker's time): a temp
   * file is also judged stale against it, so one in a directory nothing changed in since is found.
   */
  readonly migrationStartedAt?: number;
}

/** A log whose catch-up failed after its rename, and what of the replaced file it left unread. */
export interface ISessionLogCatchUpFailure extends IAppendFileCatchUpFailure {
  readonly path: string;
}

/** What a migration of one directory's logs did, or (planning) would do. */
export interface ISessionLogMigration {
  /** Logs that held plain lines: sealed (or to seal). */
  readonly logs: number;
  /** The plain lines among them. */
  readonly lines: number;
  /** Plain sidecars sealed in place (or to seal). */
  readonly payloads: number;
  /** Logs and sidecars that hold no plaintext. */
  readonly alreadySealed: number;
  /** Sealed sidecars that do not open for their session, or that a newer build sealed: left as they are. */
  readonly unopenable: readonly string[];
  /**
   * Links, entries that are not regular, logs and sidecars with another hard link, names that are not
   * session ids.
   */
  readonly refused: readonly string[];
  /**
   * Logs and sidecars that changed while being sealed, that plaintext reached meanwhile, or that
   * another rewrite replaced first.
   */
  readonly changed: readonly string[];
  /** Logs sealed whose catch-up failed: lines appended to the replaced file meanwhile are lost. */
  readonly catchUpFailed: readonly ISessionLogCatchUpFailure[];
  /** Temp files crashed writes left: removed (or to remove) with `sweepTemporaries`, else left. */
  readonly staleTemporaries: number;
}

interface IMutableLogMigration {
  logs: number;
  lines: number;
  payloads: number;
  alreadySealed: number;
  unopenable: string[];
  refused: string[];
  changed: string[];
  catchUpFailed: ISessionLogCatchUpFailure[];
  staleTemporaries: number;
}

/** The entries of `directory` by kind as `lstat` sees them; none when it is missing. */
function entriesOf(directory: string): ReadonlyMap<string, 'file' | 'directory' | 'other'> {
  const kinds = new Map<string, 'file' | 'directory' | 'other'>();
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return kinds;
    throw error;
  }
  for (const name of names.sort()) {
    try {
      const metadata = lstatSync(join(directory, name));
      kinds.set(name, metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'other');
    } catch (error) {
      // allow-fallback: an entry removed since the listing is simply not there.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return kinds;
}

/** The sessions a directory holds logs or sidecars for, each with which of the two it has. */
function sessionsOf(
  directory: string,
  result: IMutableLogMigration,
): Map<string, { log: boolean; payloads: boolean }> {
  const sessions = new Map<string, { log: boolean; payloads: boolean }>();
  for (const [name, kind] of entriesOf(directory)) {
    const isLog = name.endsWith(LOG_EXTENSION);
    const isPayloads = name.endsWith(PAYLOAD_DIRECTORY_SUFFIX);
    if (!isLog && !isPayloads) continue;
    const id = name.slice(0, -(isLog ? LOG_EXTENSION : PAYLOAD_DIRECTORY_SUFFIX).length);
    if ((isLog ? kind !== 'file' : kind !== 'directory') || !isSafeSessionId(id)) {
      result.refused.push(join(directory, name));
      continue;
    }
    const session = sessions.get(id) ?? { log: false, payloads: false };
    if (isLog) session.log = true;
    else session.payloads = true;
    sessions.set(id, session);
  }
  return sessions;
}

/** Seals one session's plain sidecars in place; returns the names it saw, for the check after the log. */
function migratePayloads(
  directory: string,
  ownerId: string,
  options: IMigrateSessionLogsOptions,
  result: IMutableLogMigration,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const replacements = replaceStagedFiles((stage) => {
    for (const [name, kind] of entriesOf(directory)) {
      if (name.endsWith(TEMPORARY_SUFFIX)) continue;
      seen.add(name);
      const path = join(directory, name);
      if (kind !== 'file') {
        result.refused.push(path);
        continue;
      }
      const read = readRegularFile(path);
      if (read === undefined) continue;
      const state = storedPayloadMigrationState(read.bytes, ownerId, options.sealer);
      if (state === 'sealed') result.alreadySealed += 1;
      else if (state !== 'plain') result.unopenable.push(path);
      if (state !== 'plain') continue;
      if (read.links > 1) {
        result.refused.push(path);
        continue;
      }
      if (!options.apply) {
        result.payloads += 1;
        continue;
      }
      stage(path, read.bytes, sealStoredPayloadBytes(read.bytes, ownerId, options.sealer));
    }
  }, options.beforeCommit);
  result.payloads += replacements.replaced;
  result.changed.push(...replacements.changed);
  result.staleTemporaries += sweepStaleStoreTemporaries(
    directory,
    options.apply && options.sweepTemporaries === true,
    options.migrationStartedAt,
  );
  return seen;
}

/** Plain sidecars that appeared in `directory` since `seen` was taken: what a writer added meanwhile. */
function plainPayloadsSince(
  directory: string,
  ownerId: string,
  seen: ReadonlySet<string>,
  sealer: IArtifactSealer,
): string[] {
  const appeared: string[] = [];
  for (const [name, kind] of entriesOf(directory)) {
    if (seen.has(name) || name.endsWith(TEMPORARY_SUFFIX) || kind !== 'file') continue;
    const read = readRegularFile(join(directory, name));
    if (
      read !== undefined &&
      storedPayloadMigrationState(read.bytes, ownerId, sealer) === 'plain'
    ) {
      appeared.push(join(directory, name));
    }
  }
  return appeared;
}

/** The plain lines in the log at `path`, or why it is not a log this migration rewrites. */
function plainLinesOf(path: string): number | 'missing' | 'refused' {
  const opened = openAppendFile(path);
  if (opened.status === 'missing') return 'missing';
  if (opened.status === 'refused') return 'refused';
  try {
    return countPlainSessionLogLines(readWhole(opened.descriptor).toString('utf8'));
  } finally {
    closeSync(opened.descriptor);
  }
}

async function migrateLog(
  path: string,
  ownerId: string,
  options: IMigrateSessionLogsOptions,
  result: IMutableLogMigration,
): Promise<void> {
  const plain = plainLinesOf(path);
  if (plain === 'missing') return;
  if (plain === 'refused') {
    result.refused.push(path);
    return;
  }
  if (plain === 0) {
    result.alreadySealed += 1;
    return;
  }
  const rewritten = !options.apply
    ? undefined
    : await rewriteAppendFile(path, new SessionLogLineSealer(options.sealer, ownerId), {
        ...(options.ownedRoot === undefined ? {} : { ownedRoot: options.ownedRoot }),
        ...(options.beforeCommit === undefined ? {} : { beforeCommit: options.beforeCommit }),
        ...(options.pause === undefined ? {} : { pause: options.pause }),
      });
  // Deleted since it was counted: nothing of it is left to seal, and nothing is put back.
  if (rewritten?.status === 'missing' || rewritten?.status === 'removed') return;
  result.logs += 1;
  result.lines += plain;
  if (rewritten === undefined) return;
  if (rewritten.status === 'refused') result.refused.push(path);
  else if (rewritten.status === 'replaced') result.changed.push(path);
  else if (rewritten.status === 'rewritten') {
    if (rewritten.plainLinesAfter > 0) result.changed.push(path);
    if (rewritten.catchUpFailed !== undefined) {
      result.catchUpFailed.push({ path, ...rewritten.catchUpFailed });
    }
  }
}

/** Seals the plain logs and sidecars of `directory` as the module documentation describes. */
export async function migrateSessionLogDirectory(
  directory: string,
  options: IMigrateSessionLogsOptions,
): Promise<ISessionLogMigration> {
  const result: IMutableLogMigration = {
    logs: 0,
    lines: 0,
    payloads: 0,
    alreadySealed: 0,
    unopenable: [],
    refused: [],
    changed: [],
    catchUpFailed: [],
    staleTemporaries: 0,
  };
  try {
    if (!lstatSync(directory).isDirectory()) {
      result.refused.push(directory);
      return result;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }
  for (const [id, session] of sessionsOf(directory, result)) {
    const payloadDirectory = join(directory, `${id}${PAYLOAD_DIRECTORY_SUFFIX}`);
    const seen = session.payloads
      ? migratePayloads(payloadDirectory, id, options, result)
      : new Set<string>();
    if (session.log)
      await migrateLog(join(directory, `${id}${LOG_EXTENSION}`), id, options, result);
    if (options.apply && session.payloads) {
      result.changed.push(...plainPayloadsSince(payloadDirectory, id, seen, options.sealer));
    }
  }
  result.staleTemporaries += sweepStaleStoreTemporaries(
    directory,
    options.apply && options.sweepTemporaries === true,
    options.migrationStartedAt,
  );
  return result;
}
