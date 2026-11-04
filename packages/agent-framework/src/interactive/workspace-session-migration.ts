/**
 * Sealing in place what a trusted project's session store kept in plaintext — its records, its replay
 * logs with their sidecars, and the subagent logs older builds wrote beside them — for a host
 * migrating its state once it seals (#3679). Every read and write goes through the project's
 * runtime-minted state storage, so a migration writes a project only as the store itself would: on a
 * host that can write project state, under the trusted root, never through a link.
 *
 * Records are sealed as their raw bytes, whatever they hold, under their own stem; logs become one
 * sealed record per non-empty plain line, and sidecars are sealed in place under their names, before
 * their log (`@robota-sdk/agent-session`'s converters hold both formats). A project file is read back
 * only up to the project read limit, so what would be sealed past it — or is past it already — stays
 * plain and is reported. Whether something is done is decided by whether it opens for its session; a
 * sealed file that does not open here is left as it is, and a file with another hard link is refused,
 * since replacing it would leave the plaintext under the other name. Every sealed record of the store,
 * and every sealed sidecar of a session, is written beside its file and flushed before any is put in
 * place; each replace is then atomic, and is made only if the file still holds what was read
 * (`project-state-replacement.ts`).
 */
import { createHash } from 'node:crypto';
import { isSafeSessionId } from '@robota-sdk/agent-session';
import {
  countPlainSessionLogLines,
  isPlainSessionRecordOf,
  sealSessionLogText,
  sealStoredPayloadBytes,
  sealStoredSessionBytes,
  storedPayloadMigrationState,
  storedSessionMigrationState,
} from '@robota-sdk/agent-session/node';

import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import { MAX_PROJECT_READ_BYTES } from '../workspace-trust/project-reader-path.js';
import {
  projectStateFileHardLinked,
  readCappedProjectStateFile,
  replaceProjectStateFileIfUnchanged,
  replaceStagedProjectStateFiles,
} from '../workspace-trust/project-state-replacement.js';
import { sweepWorkspaceProjectStateTemporaries } from '../workspace-trust/project-state-storage.js';

import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type { ISessionLogMigration } from '@robota-sdk/agent-session/node';

const RECORD_EXTENSION = '.json';
const LOG_EXTENSION = '.jsonl';
const PAYLOAD_DIRECTORY_SUFFIX = '.payloads';
const SUBAGENT_LOG_DIRECTORY = 'subagents';
const PURPOSE = 'migrate project conversation state';

export interface IMigrateWorkspaceProjectStateOptions {
  /** Seals what is plain and opens what is sealed; the keys must be unlocked. */
  readonly sealer: IArtifactSealer;
  /** `false` plans: everything is read and counted exactly as a run would, and nothing is written. */
  readonly apply: boolean;
  /** Runs before each replace; throwing stops the migration there with that file as it was. */
  readonly beforeCommit?: () => void;
  /**
   * Also removes the temp files crashed replaces left; leave it off while another writer may be running.
   * Off, they are still counted in `staleTemporaries` and left where they are.
   */
  readonly sweepTemporaries?: boolean;
  /**
   * When the migration started, in milliseconds by the filesystem's clock (its marker's time): a temp
   * file is also judged stale against it, so one in a directory nothing changed in since is found.
   */
  readonly migrationStartedAt?: number;
}

/** What a migration of a project's session records did, or (planning) would do. Paths are project-relative. */
export interface IWorkspaceSessionRecordMigration {
  readonly sealed: number;
  readonly alreadySealed: number;
  /** Sealed records that do not open here, or that a newer build sealed: left as they are. */
  readonly unopenable: readonly string[];
  /** `.json` files whose name is not a session id: left as they are. */
  readonly unsafeNames: readonly string[];
  /** `.json` entries that are links, not regular files, or have another hard link: left as they are. */
  readonly refused: readonly string[];
  /** Records past the project read limit, or that would be once sealed: left plain. */
  readonly overCap: readonly string[];
  /** Records that changed while being sealed: left as they are, for the next run. */
  readonly changed: readonly string[];
  /** Stale temp files found: removed (or to remove) with `sweepTemporaries`, else left where they are. */
  readonly staleTemporaries: number;
  /**
   * Each record this run sealed, by its id and the SHA-256 of the sealed bytes it put in place — the
   * bytes the owner may then vouch for, and no others. Empty when planning.
   */
  readonly sealedRecords: readonly { readonly id: string; readonly digest: string }[];
}

/** What a migration of a project's session logs did, or (planning) would do. Paths are project-relative. */
export interface IWorkspaceSessionLogMigration extends ISessionLogMigration {
  /** Logs and sidecars past the project read limit, or that would be once sealed: left plain. */
  readonly overCap: readonly string[];
}

function assertNamespace(
  storage: IWorkspaceProjectStateStorage,
  namespace: 'sessions' | 'session-logs',
): IWorkspaceProjectStateStorage {
  const accepted = assertWorkspaceProjectStateStorage(storage);
  if (accepted.namespace !== namespace) {
    throw new Error(`Migrating project ${namespace} requires the ${namespace} state namespace.`);
  }
  return accepted;
}

/** The bytes at `name`, `'over-cap'` past the read limit, `undefined` when it is gone. */
function readCapped(
  storage: IWorkspaceProjectStateStorage,
  name: string,
): Uint8Array | 'over-cap' | undefined {
  return readCappedProjectStateFile(storage, name, PURPOSE);
}

/** Seals the plain records of a project's `sessions` storage as the module documentation describes. */
export function migrateWorkspaceProjectSessionRecords(
  storage: IWorkspaceProjectStateStorage,
  options: IMigrateWorkspaceProjectStateOptions,
): IWorkspaceSessionRecordMigration {
  const sessions = assertNamespace(storage, 'sessions');
  const result = {
    sealed: 0,
    alreadySealed: 0,
    unopenable: [] as string[],
    unsafeNames: [] as string[],
    refused: [] as string[],
    overCap: [] as string[],
    changed: [] as string[],
    staleTemporaries: 0,
    sealedRecords: [] as { readonly id: string; readonly digest: string }[],
  };
  const staged: { readonly path: string; readonly id: string; readonly digest: string }[] = [];
  const replacements = replaceStagedProjectStateFiles(
    sessions,
    PURPOSE,
    (stage) => {
      for (const entry of sessions.listDirectory('', PURPOSE)) {
        if (!entry.name.endsWith(RECORD_EXTENSION)) continue;
        const path = sessions.projectRelativePath(entry.name);
        const id = entry.name.slice(0, -RECORD_EXTENSION.length);
        if (entry.kind !== 'file') result.refused.push(path);
        else if (!isSafeSessionId(id)) result.unsafeNames.push(path);
        if (entry.kind !== 'file' || !isSafeSessionId(id)) continue;
        const raw = readCapped(sessions, entry.name);
        if (raw === undefined) continue;
        if (raw === 'over-cap') {
          result.overCap.push(path);
          continue;
        }
        const state = storedSessionMigrationState(id, raw, options.sealer);
        if (state === 'sealed') result.alreadySealed += 1;
        else if (state !== 'plain') result.unopenable.push(path);
        if (state !== 'plain') continue;
        if (projectStateFileHardLinked(sessions, entry.name)) {
          result.refused.push(path);
          continue;
        }
        const sealed = sealStoredSessionBytes(id, raw, options.sealer);
        if (sealed.byteLength > MAX_PROJECT_READ_BYTES) {
          result.overCap.push(path);
          continue;
        }
        if (!options.apply) {
          result.sealed += 1;
          continue;
        }
        // Only a record that reads as this session's is a session the owner could mark as theirs.
        if (isPlainSessionRecordOf(id, raw)) {
          staged.push({ path, id, digest: createHash('sha256').update(sealed).digest('hex') });
        }
        stage(entry.name, path, raw, sealed);
      }
    },
    options.beforeCommit,
  );
  result.sealed += replacements.replaced;
  result.changed.push(...replacements.changed);
  // Every staged record was put in place but those that changed meanwhile, since anything else
  // that stops a replacement throws out of it.
  for (const { path, id, digest } of staged) {
    if (!replacements.changed.includes(path)) result.sealedRecords.push({ id, digest });
  }
  result.staleTemporaries = sweepWorkspaceProjectStateTemporaries(
    sessions,
    '',
    options.apply && options.sweepTemporaries === true,
    options.migrationStartedAt,
  );
  return result;
}

interface IMutableWorkspaceLogMigration {
  logs: number;
  lines: number;
  payloads: number;
  alreadySealed: number;
  unopenable: string[];
  refused: string[];
  changed: string[];
  /** Always empty: a project log has no writer to catch up, so it is replaced whole. */
  catchUpFailed: never[];
  overCap: string[];
  staleTemporaries: number;
}

function joinPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

function migratePayloads(
  logs: IWorkspaceProjectStateStorage,
  directory: string,
  ownerId: string,
  options: IMigrateWorkspaceProjectStateOptions,
  result: IMutableWorkspaceLogMigration,
): void {
  const replacements = replaceStagedProjectStateFiles(
    logs,
    PURPOSE,
    (stage) => {
      for (const entry of logs.listDirectory(directory, PURPOSE)) {
        const name = joinPath(directory, entry.name);
        const path = logs.projectRelativePath(name);
        if (entry.kind !== 'file') {
          result.refused.push(path);
          continue;
        }
        const stored = readCapped(logs, name);
        if (stored === undefined) continue;
        if (stored === 'over-cap') {
          result.overCap.push(path);
          continue;
        }
        const state = storedPayloadMigrationState(stored, ownerId, options.sealer);
        if (state === 'sealed') result.alreadySealed += 1;
        else if (state !== 'plain') result.unopenable.push(path);
        if (state !== 'plain') continue;
        if (projectStateFileHardLinked(logs, name)) {
          result.refused.push(path);
          continue;
        }
        const sealed = sealStoredPayloadBytes(stored, ownerId, options.sealer);
        if (sealed.byteLength > MAX_PROJECT_READ_BYTES) {
          result.overCap.push(path);
          continue;
        }
        if (!options.apply) {
          result.payloads += 1;
          continue;
        }
        stage(name, path, stored, sealed);
      }
    },
    options.beforeCommit,
  );
  result.payloads += replacements.replaced;
  result.changed.push(...replacements.changed);
  result.staleTemporaries += sweepWorkspaceProjectStateTemporaries(
    logs,
    directory,
    options.apply && options.sweepTemporaries === true,
    options.migrationStartedAt,
  );
}

function migrateLog(
  logs: IWorkspaceProjectStateStorage,
  name: string,
  ownerId: string,
  options: IMigrateWorkspaceProjectStateOptions,
  result: IMutableWorkspaceLogMigration,
): void {
  const path = logs.projectRelativePath(name);
  const stored = readCapped(logs, name);
  if (stored === undefined) return;
  if (stored === 'over-cap') {
    result.overCap.push(path);
    return;
  }
  const text = Buffer.from(stored).toString('utf8');
  const plain = countPlainSessionLogLines(text);
  if (plain === 0) {
    result.alreadySealed += 1;
    return;
  }
  if (projectStateFileHardLinked(logs, name)) {
    result.refused.push(path);
    return;
  }
  const sealed = Buffer.from(sealSessionLogText(text, ownerId, options.sealer).text, 'utf8');
  if (sealed.byteLength > MAX_PROJECT_READ_BYTES) {
    result.overCap.push(path);
    return;
  }
  if (
    !options.apply ||
    replaceProjectStateFileIfUnchanged(logs, name, stored, sealed, PURPOSE, options.beforeCommit)
  ) {
    result.logs += 1;
    result.lines += plain;
  } else {
    result.changed.push(path);
  }
}

/** One directory of logs: every session's sidecars, then its log. */
function migrateLogDirectory(
  logs: IWorkspaceProjectStateStorage,
  directory: string,
  options: IMigrateWorkspaceProjectStateOptions,
  result: IMutableWorkspaceLogMigration,
): string[] {
  const sessions = new Map<string, { log: boolean; payloads: boolean }>();
  const parents: string[] = [];
  for (const entry of logs.listDirectory(directory, PURPOSE)) {
    const isLog = entry.name.endsWith(LOG_EXTENSION);
    const isPayloads = entry.name.endsWith(PAYLOAD_DIRECTORY_SUFFIX);
    if (!isLog && !isPayloads) {
      if (entry.kind === 'directory') parents.push(entry.name);
      continue;
    }
    const id = entry.name.slice(0, -(isLog ? LOG_EXTENSION : PAYLOAD_DIRECTORY_SUFFIX).length);
    if (entry.kind !== (isLog ? 'file' : 'directory') || !isSafeSessionId(id)) {
      result.refused.push(logs.projectRelativePath(joinPath(directory, entry.name)));
      continue;
    }
    const session = sessions.get(id) ?? { log: false, payloads: false };
    if (isLog) session.log = true;
    else session.payloads = true;
    sessions.set(id, session);
  }
  for (const [id, session] of sessions) {
    if (session.payloads) {
      migratePayloads(
        logs,
        joinPath(directory, `${id}${PAYLOAD_DIRECTORY_SUFFIX}`),
        id,
        options,
        result,
      );
    }
    if (session.log) {
      migrateLog(logs, joinPath(directory, `${id}${LOG_EXTENSION}`), id, options, result);
    }
  }
  result.staleTemporaries += sweepWorkspaceProjectStateTemporaries(
    logs,
    directory,
    options.apply && options.sweepTemporaries === true,
    options.migrationStartedAt,
  );
  return parents;
}

/**
 * Seals the plain replay logs of a project's `session-logs` storage, and the subagent logs older
 * builds kept in its `<parent>/subagents/` directories, as the module documentation describes.
 */
export function migrateWorkspaceProjectSessionLogs(
  storage: IWorkspaceProjectStateStorage,
  options: IMigrateWorkspaceProjectStateOptions,
): IWorkspaceSessionLogMigration {
  const logs = assertNamespace(storage, 'session-logs');
  const result: IMutableWorkspaceLogMigration = {
    logs: 0,
    lines: 0,
    payloads: 0,
    alreadySealed: 0,
    unopenable: [],
    refused: [],
    changed: [],
    catchUpFailed: [],
    overCap: [],
    staleTemporaries: 0,
  };
  for (const parent of migrateLogDirectory(logs, '', options, result)) {
    const directory = `${parent}/${SUBAGENT_LOG_DIRECTORY}`;
    const subagents = logs
      .listDirectory(parent, PURPOSE)
      .find((entry) => entry.name === SUBAGENT_LOG_DIRECTORY);
    if (subagents?.kind === 'directory') migrateLogDirectory(logs, directory, options, result);
    else if (subagents !== undefined) result.refused.push(logs.projectRelativePath(directory));
  }
  return result;
}
