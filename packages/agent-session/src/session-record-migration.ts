/**
 * Sealing in place the records a host-filesystem session store (`NodeSessionStore`) kept in
 * plaintext, for a host migrating its state once it seals (#3679).
 *
 * Every plain record is sealed as the raw bytes it holds — valid, corrupt, unsupported or bare alike —
 * under its own file stem, so the store reports the same status after opening it, and the plaintext is
 * gone. Whether a record is already done is decided by whether it opens for its id, never by framing
 * alone: a sealed record that does not open here, or that a newer build sealed, is left as it is and
 * reported. A file whose name is not a session id, anything that is not a regular file, and a file
 * with another hard link (replacing it would leave the plaintext under the other name) is never
 * touched, and neither is a record whose writer marker stands for a process not provably gone: it may
 * be saving it now. Every sealed record is written beside its file and flushed before any is put in
 * place; each replace is then atomic, and is made only if the file still holds the bytes that were
 * read, so a record a running process saved meanwhile is left for the next run.
 */
import { createProcessOperationLock } from './process-operation-lock.js';

import { lstatSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { createProcessMarkers } from '@robota-sdk/agent-core/node';

import { isSafeSessionId } from './session-id.js';
import { SESSION_CLAIMS_DIRECTORY } from './session-store.js';
import { sweepStaleStoreTemporaries } from './stale-temporaries.js';
import { readRegularFile, replaceStagedFiles } from './staged-replacements.js';
import { openStoredSessionRecord } from './stored-session-authorship.js';
import {
  digestOf,
  isPlainSessionRecordOf,
  sealStoredSessionBytes,
  storedSessionMigrationState,
} from './stored-session-codec.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';

const RECORD_EXTENSION = '.json';

export interface IMigrateSessionRecordsOptions {
  /** Seals what is plain and opens what is sealed; the keys must be unlocked. */
  readonly sealer: IArtifactSealer;
  /** `false` plans: everything is read and counted exactly as a run would, and nothing is written. */
  readonly apply: boolean;
  /**
   * Runs before each replace, after the sealed record is written and flushed beside it; throwing
   * stops the migration there with that record as it was.
   */
  readonly beforeCommit?: () => void;
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

/** What a migration of a store's records did, or (planning) would do. */
export interface ISessionRecordMigration {
  /** Plain records sealed (or to seal). */
  readonly sealed: number;
  /** Records that already open sealed. */
  readonly alreadySealed: number;
  /** Sealed records that do not open here, or that a newer build sealed: left as they are. */
  readonly unopenable: readonly string[];
  /** `.json` files whose name is not a session id: left as they are. */
  readonly unsafeNames: readonly string[];
  /**
   * `.json` entries that are links, not regular files, or regular files with another hard link:
   * never followed or replaced, left as they are.
   */
  readonly refused: readonly string[];
  /** Records that changed while being sealed: left as they are, for the next run. */
  readonly changed: readonly string[];
  /**
   * The ids of records open in another process — their writer marker stands for an owner not
   * provably gone — left as they are, for a run after it has closed.
   */
  readonly held: readonly string[];
  /** Temp files crashed writes left with a record in them: removed (or to remove) with `sweepTemporaries`, else left. */
  readonly staleTemporaries: number;
  /**
   * Each record this run sealed, by its id and the SHA-256 of the sealed bytes it put in place — the
   * bytes the owner may then vouch for (`ISessionAuthorship.adopt`), and no others.
   * Empty when planning.
   */
  readonly sealedRecords: readonly ISealedSessionRecord[];
}

/** One record a migration sealed: its id and the SHA-256 (lowercase hex) of the bytes it wrote. */
export interface ISealedSessionRecord {
  readonly id: string;
  readonly digest: string;
}

/** The `.json` entries of `baseDir`, each a regular file or refused; none when the directory is missing. */
function recordEntries(baseDir: string): { readonly files: string[]; readonly refused: string[] } {
  const files: string[] = [];
  const refused: string[] = [];
  let names: string[];
  try {
    if (!lstatSync(baseDir).isDirectory()) return { files, refused: [baseDir] };
    names = readdirSync(baseDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { files, refused };
    throw error;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(RECORD_EXTENSION)) continue;
    try {
      (lstatSync(join(baseDir, name)).isFile() ? files : refused).push(name);
    } catch (error) {
      // allow-fallback: an entry removed since the listing is simply not there.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { files, refused: refused.map((name) => join(baseDir, name)) };
}

/** Seals the plain records of the store at `baseDir` as the module documentation describes. */
export function migrateNodeSessionStore(
  baseDir: string,
  options: IMigrateSessionRecordsOptions,
): ISessionRecordMigration {
  const { files, refused } = recordEntries(baseDir);
  const result = {
    sealed: 0,
    alreadySealed: 0,
    unopenable: [] as string[],
    unsafeNames: [] as string[],
    refused,
    changed: [] as string[],
    held: [] as string[],
    staleTemporaries: 0,
    sealedRecords: [] as ISealedSessionRecord[],
  };
  const markers = createProcessMarkers(join(baseDir, SESSION_CLAIMS_DIRECTORY), {
    operationLock: createProcessOperationLock(join(baseDir, SESSION_CLAIMS_DIRECTORY)),
  });
  const staged: (ISealedSessionRecord & { readonly path: string })[] = [];
  const replacements = replaceStagedFiles(
    (stage) => {
      for (const name of files) {
        const path = join(baseDir, name);
        const id = name.slice(0, -RECORD_EXTENSION.length);
        if (!isSafeSessionId(id)) {
          result.unsafeNames.push(path);
          continue;
        }
        const writer = markers.inspect(id);
        if (writer.status === 'held' && writer.holder.liveness !== 'gone') {
          result.held.push(id);
          continue;
        }
        const read = readRegularFile(path);
        if (read === undefined) continue;
        const state = storedSessionMigrationState(id, read.bytes, options.sealer);
        if (state === 'sealed') result.alreadySealed += 1;
        else if (state !== 'plain') result.unopenable.push(path);
        if (state !== 'plain') continue;
        if (read.links > 1) {
          result.refused.push(path);
          continue;
        }
        if (!options.apply) {
          result.sealed += 1;
          continue;
        }
        const sealed = sealStoredSessionBytes(id, read.bytes, options.sealer);
        // Only a record that reads as this session's is a session the owner could mark as theirs; a
        // corrupt or unsupported one is sealed as it is and stays what it was.
        if (isPlainSessionRecordOf(id, read.bytes)) {
          staged.push({ path, id, digest: digestOf(sealed) });
        }
        stage(path, read.bytes, sealed);
      }
    },
    options.beforeCommit,
    (path, commit) => {
      const id = basename(path).slice(0, -RECORD_EXTENSION.length);
      const acquired = markers.acquire(id);
      if (acquired.status !== 'acquired') {
        result.held.push(id);
        return false;
      }
      try {
        const guarded = acquired.handle.withGuard(commit);
        if (guarded.status !== 'ran') {
          result.held.push(id);
          return false;
        }
        return true;
      } finally {
        acquired.handle.release();
      }
    },
  );
  result.sealed += replacements.replaced;
  result.changed.push(...replacements.changed);
  // Every staged record was put in place but those that changed meanwhile, since anything else
  // that stops a replacement throws out of it.
  for (const { path, id, digest } of staged) {
    if (!replacements.changed.includes(path)) result.sealedRecords.push({ id, digest });
  }
  result.staleTemporaries = sweepStaleStoreTemporaries(
    baseDir,
    options.apply && options.sweepTemporaries === true,
    options.migrationStartedAt,
  );
  return result;
}

/**
 * The working directories the store's records name — a valid record's `cwd`, and the `cwd` a corrupt
 * or unsupported one still carries — opened with `sealer`, distinct, in file order. Writes nothing;
 * a record that does not open names none.
 */
export function readSessionStoreWorkingDirectories(
  baseDir: string,
  options: { readonly sealer: IArtifactSealer },
): readonly string[] {
  const directories = new Set<string>();
  for (const name of recordEntries(baseDir).files) {
    const id = name.slice(0, -RECORD_EXTENSION.length);
    if (!isSafeSessionId(id)) continue;
    const read = readRegularFile(join(baseDir, name));
    if (read === undefined) continue;
    const outcome = openStoredSessionRecord(id, read.bytes, options.sealer);
    const cwd =
      outcome.status === 'valid'
        ? outcome.record.cwd
        : outcome.status === 'corrupt' || outcome.status === 'unsupported'
          ? outcome.cwd
          : undefined;
    if (typeof cwd === 'string' && cwd.length > 0) directories.add(cwd);
  }
  return [...directories];
}
