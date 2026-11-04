import { isArtifactCorruptError, isArtifactLockedError } from '@robota-sdk/agent-core';
import { createProcessMarkers } from '@robota-sdk/agent-core/node';
import {
  SessionLogDecodeError,
  SessionLogPayloadResolutionError,
  assertSafeSessionId,
  decodeInteractiveSessionRecord,
  isSafeSessionId,
  loadSessionLogEntries,
  replaySessionLogEntries,
} from '@robota-sdk/agent-session';
import {
  SESSION_CLAIMS_DIRECTORY,
  StoredSessionRecords,
  classifyStoredSessionBytes,
  sessionSealingOf,
} from '@robota-sdk/agent-session/node';

import { deriveBackgroundJobGroups, deriveBackgroundTasks } from './session-replay-state.js';
import { WorkspaceSessionLogSource } from './workspace-session-io.js';
import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import { ProjectReadLimitExceededError } from '../workspace-trust/project-reader-path.js';
import {
  assertWorkspaceProjectStateStoragePair,
  workspaceProjectStateDirectoryPath,
} from '../workspace-trust/project-state-storage.js';

import type { IMemoryEvent } from '../memory/automatic-memory-types.js';
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type { TArtifactSealing } from '@robota-sdk/agent-core';
import type {
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionAuthorship,
  ISessionClaim,
  ISessionClaimOptions,
  ISessionExportOptions,
  ISessionLease,
  ISessionListEntry,
  ISessionLoadOptions,
  ISessionSaveOptions,
  ISessionStoreScan,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';
import type { ISessionStoreOptions, TStoredSessionFile } from '@robota-sdk/agent-session/node';

function assertNamespace(
  storage: IWorkspaceProjectStateStorage,
  namespace: 'sessions' | 'session-logs',
): IWorkspaceProjectStateStorage {
  const accepted = assertWorkspaceProjectStateStorage(storage);
  if (accepted.namespace !== namespace) {
    throw new Error(`Workspace session persistence requires the ${namespace} state namespace.`);
  }
  return accepted;
}

/** An unreadable entry has no `updatedAt`; the epoch keeps it present and out of the way. */
function recencyOf(entry: ISessionListEntry): number {
  return entry.outcome.status === 'valid' ? new Date(entry.outcome.record.updatedAt).getTime() : 0;
}

/**
 * The ONE producer of a `valid` outcome in this store.
 *
 * JSONL entries are decoded before replay. The reconstructed record is a separate boundary:
 * validate it here so both load and list return a complete, decoded record or an explicit failure.
 */
function asValidatedOutcome(record: IInteractiveSessionRecord): TSessionLoadOutcome {
  const outcome = decodeInteractiveSessionRecord(record);
  if (outcome.status === 'valid') return { status: 'valid', record: outcome.record };
  if (outcome.status === 'corrupt') return { status: 'corrupt', issues: outcome.issues };
  // A record built in memory carries no envelope, so `unsupported` cannot arise from this path; it
  // is mapped rather than ignored, because a silently dropped branch is how the next member of this
  // union goes unhandled.
  return { status: 'unsupported', schemaVersion: outcome.schemaVersion };
}

/** What a load reports for a file past the project read limit; fixed, so it carries no content. */
const OVERSIZED_OUTCOME: TSessionLoadOutcome = Object.freeze({
  status: 'corrupt',
  issues: Object.freeze([
    Object.freeze({ path: '', message: 'the session file is larger than this store reads' }),
  ]),
});

/** What a load reports for a replay log whose entries name another session; fixed, so it carries no content. */
const OTHER_ID_LOG_OUTCOME: TSessionLoadOutcome = Object.freeze({
  status: 'corrupt',
  issues: Object.freeze([
    Object.freeze({ path: 'sessionId', message: 'the session log belongs to another session id' }),
  ]),
});

/** A replay log this store cannot open while the keys are locked: present, and a later unlock reads it. */
const LOCKED_LOG_OUTCOME: TSessionLoadOutcome = Object.freeze({ status: 'locked' });
/** A sealed replay log and a store that seals nothing: present, and no key in this process opens it. */
const NO_KEYS_LOG_OUTCOME: TSessionLoadOutcome = Object.freeze({
  status: 'locked',
  reason: 'no-keys',
});
/** A sealed line of a replay log that does not open; fixed, so it carries no content. */
const SEALED_LINE_DOES_NOT_OPEN_OUTCOME: TSessionLoadOutcome = Object.freeze({
  status: 'corrupt',
  issues: Object.freeze([
    Object.freeze({
      path: '',
      message:
        'a sealed line of the session log does not open for this session: it is damaged or sealed with other keys',
    }),
  ]),
});
/** A replay-log payload that could not be read, opened or matched to its reference; fixed, so it carries no content. */
const PAYLOAD_UNREADABLE_OUTCOME: TSessionLoadOutcome = Object.freeze({
  status: 'corrupt',
  issues: Object.freeze([
    Object.freeze({
      path: '',
      message: 'a payload of the session log could not be read or does not match its reference',
    }),
  ]),
});

/** Project session record adapter backed only by runtime-minted state facets. */
export class WorkspaceProjectSessionStore implements IInteractiveSessionStore {
  private readonly sessions: IWorkspaceProjectStateStorage;
  private readonly logs: IWorkspaceProjectStateStorage;
  /** How this store keeps what it writes; its replay logs are read with the same sealing. */
  private readonly sealing: TArtifactSealing;
  /** How records are stored, and what this instance claims, wrote or holds. */
  private readonly records: StoredSessionRecords;
  /** What only a store that seals offers (`IInteractiveSessionStore.authorship`); absent from one that never does. */
  declare readonly authorship?: ISessionAuthorship;

  /**
   * @param options `sealing` (required): `{ sealer }` seals what `save` writes and opens what `load`
   *   reads, replay logs included; `'plain'` writes plain records and meets a sealed file as
   *   `locked`. `releaseCommand`: see `ISessionStoreOptions`.
   */
  constructor(
    sessions: IWorkspaceProjectStateStorage,
    logs: IWorkspaceProjectStateStorage,
    options: ISessionStoreOptions,
  ) {
    this.sealing = sessionSealingOf(options);
    this.sessions = assertNamespace(sessions, 'sessions');
    this.logs = assertNamespace(logs, 'session-logs');
    assertWorkspaceProjectStateStoragePair(this.sessions, this.logs);
    // The writer markers are published by hard links, which no facet call makes, so the claims
    // directory beside the records is reached by its path, checked through the authority-gated facet.
    const markers = createProcessMarkers(
      workspaceProjectStateDirectoryPath(this.sessions, SESSION_CLAIMS_DIRECTORY),
    );
    this.records = new StoredSessionRecords(
      this.sealing,
      {
        load: (id) => this.loadFile(id),
        current: (id) => {
          assertSafeSessionId(id);
          return this.readExisting(`${id}.json`);
        },
        replace: (id, stored) => {
          assertSafeSessionId(id);
          this.writeRecord(`${id}.json`, stored);
        },
        rebuild: (id) => this.loadFromReplayLog(id),
      },
      markers,
      options.releaseCommand === undefined ? {} : { releaseCommand: options.releaseCommand },
    );
    // Only on a store that seals: a store whose records carry no authorship has nothing to adopt.
    const authorship = this.records.authorship;
    if (authorship !== undefined) this.authorship = authorship;
  }

  /**
   * Claims `id` for a session this process runs, reading it in the same call
   * (`IInteractiveSessionStore.claim`): exclusive across processes and store instances, and every
   * later save of the id must carry the claim until it is released. In a store that seals, a claimed
   * id is never rebuilt from its replay log, which no tag covers; a store that never seals rebuilds it
   * as any read would.
   */
  claim(id: string, options?: ISessionClaimOptions): ISessionClaim {
    assertSafeSessionId(id);
    return this.records.claim(id, options);
  }

  /** Lends `id` to another process that will write it (`IInteractiveSessionStore.lend`). */
  lend(id: string): ISessionLease {
    assertSafeSessionId(id);
    return this.records.lend(id);
  }

  /** Whether session `id` may have a writer now (`IInteractiveSessionStore.hasWriter`). */
  hasWriter(id: string): boolean {
    assertSafeSessionId(id);
    return this.records.hasWriter(id);
  }

  save(session: IInteractiveSessionRecord, options: ISessionSaveOptions = {}): void {
    assertSafeSessionId(session.id);
    // A sealed file this store cannot open is a session nobody here has read; replacing it would
    // destroy the only copy — unless it is provably exactly what this instance last wrote or holds,
    // which is how a locked process goes on saving the sessions it is running. A plain or absent
    // file is replaced.
    // TRANS-007: the versioned envelope, the same shape the host store and the share artifact carry;
    // sealed to the session's id by a store that seals, and tagged when it can vouch that the content
    // is the owner's and the keys are unlocked.
    this.records.save(session, options);
  }

  /**
   * Replaces the record file `name` whole, so a write that fails part-way leaves the previous record,
   * which this store still recognises, rather than a partial file.
   */
  private writeRecord(name: string, stored: Uint8Array): void {
    this.sessions.replaceBytes(name, stored, 'persist project session record');
  }

  /** What is at `name` now, for the guard before a save; a file past the read limit is `oversized`. */
  private readExisting(name: string): TStoredSessionFile {
    try {
      return classifyStoredSessionBytes(
        this.sessions.readBytes(name, 'check the project session record before replacing it'),
      );
    } catch (error) {
      if (error instanceof ProjectReadLimitExceededError) return { kind: 'oversized' };
      throw error;
    }
  }

  /**
   * Load a session, saying which of the five things happened.
   *
   * **The replay log runs for `missing` and only for `missing` (TRANS-007).** It used to run
   * whenever the parse failed, so a damaged snapshot was quietly replaced by a partial
   * reconstruction — no `goal`, no `plan`, no `activeBranch`, no `toolSchemas`, and no indication
   * that a more complete record was sitting on disk unreadable. Recovery is for absence; a damaged
   * record is reported — and a `locked` one is present too, so a sealed snapshot the keys cannot
   * open never falls through to a reconstruction either. Nor does a snapshot past the read limit:
   * it is present, so it is `corrupt` rather than a reason to rebuild it or to take a listing down.
   *
   * Only a load that asks to `hold` the session remembers a sealed record it opens. A session this
   * process runs (claimed) is never rebuilt from its log: a log carries no authorship, so the store
   * answers such an id from what it holds instead.
   */
  load(id: string, options: ISessionLoadOptions = {}): TSessionLoadOutcome {
    assertSafeSessionId(id);
    return this.records.load(id, options);
  }

  /** What is at session `id`'s snapshot path, read whole, for one load or listing of it. */
  private loadFile(id: string): {
    readonly file: TStoredSessionFile;
    readonly unreadable: TSessionLoadOutcome;
  } {
    assertSafeSessionId(id);
    let raw: Uint8Array | undefined;
    try {
      raw = this.sessions.readBytes(`${id}.json`, 'load project session record');
    } catch (error) {
      if (!(error instanceof ProjectReadLimitExceededError)) throw error;
      return { file: { kind: 'oversized' }, unreadable: OVERSIZED_OUTCOME };
    }
    return { file: classifyStoredSessionBytes(raw), unreadable: OVERSIZED_OUTCOME };
  }

  /**
   * The record this instance itself last wrote or holds, offered only while the stored file is
   * still exactly those bytes — what a writer needs when `load` says `locked` for a session it is
   * running. `undefined` for a session this instance never held, or whose file has changed since.
   *
   * One more answer, for the writer only: a session with no snapshot whose replay log this process
   * cannot open now is `missing`. A session that logs before its first save is exactly that, and a
   * save writes the snapshot beside the log and destroys nothing of it, so there is nothing to
   * protect. A reader that is not about to write keeps hearing `locked` from {@link load}, so it
   * never takes that log for an absent session.
   */
  loadHeld(id: string): TSessionLoadOutcome | undefined {
    assertSafeSessionId(id);
    const held = this.records.loadHeld(id);
    if (held !== undefined) return held;
    if (
      this.readExisting(`${id}.json`).kind === 'absent' &&
      this.loadFromReplayLog(id).status === 'locked'
    ) {
      return { status: 'missing' };
    }
    return undefined;
  }

  /** The sealed record of `id` as a token for another store over these files (`StoredSessionRecords.exportHeld`). */
  exportHeld(id: string, options?: ISessionExportOptions): string | undefined {
    assertSafeSessionId(id);
    return this.records.exportHeld(id, options);
  }

  /** Holds the record a token from another store's `exportHeld` carries (`StoredSessionRecords.importHeld`). */
  importHeld(id: string, token: string): void {
    assertSafeSessionId(id);
    this.records.importHeld(id, token);
  }

  /**
   * Every session this project holds, each with what the store concluded about it.
   *
   * An entry it cannot read is REPORTED rather than filtered away — hiding two of four outcomes from
   * the surface a person browses moves the defect instead of removing it. Replay-only sessions
   * (a log with no snapshot) still appear, as they did before.
   *
   * The one exception is a sealed snapshot the keys cannot open: there is no record to describe, so
   * it is not an entry, and {@link scan} says how many were left out. It still counts as present
   * here, so its replay log is not read as though the snapshot were absent.
   */
  list(): readonly ISessionListEntry[] {
    return this.scan().entries;
  }

  /**
   * The listing and how many sealed sessions it left out, by why — locked keys, or no keys here at
   * all — from one read of each file; see {@link list}.
   */
  scan(): ISessionStoreScan {
    const all = this.readAll();
    const noKeys = all.filter(
      ({ outcome }) => outcome.status === 'locked' && outcome.reason === 'no-keys',
    ).length;
    const locked = all.filter(({ outcome }) => outcome.status === 'locked').length - noKeys;
    return {
      entries: all
        .filter((entry) => entry.outcome.status !== 'locked')
        .sort((left, right) => recencyOf(right) - recencyOf(left)),
      locked,
      ...(noKeys === 0 ? {} : { noKeys }),
    };
  }

  private readAll(): ISessionListEntry[] {
    const snapshots = this.sessions
      .listDirectory('', 'list project session records')
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .map((id) => ({ id, outcome: this.outcomeForListedId(id) }));
    const seen = new Set(snapshots.map((entry) => entry.id));
    const entries: ISessionListEntry[] = [...snapshots];
    for (const id of this.listReplayLogIds()) {
      if (!seen.has(id)) {
        entries.push({ id, outcome: this.outcomeForListedId(id) });
      }
    }
    return entries;
  }

  /**
   * The outcome for one directory entry, without letting a bad NAME remove it from the listing.
   *
   * `load` validates the id because a caller's malformed id is a bug or an attack (SEC-006). A name
   * read out of the project directory is neither, and the two wrong answers are symmetrical: throw,
   * and one file takes the listing down; filter, and the file disappears exactly the way an
   * unreadable record used to. The second is what this store did.
   */
  private outcomeForListedId(id: string): TSessionLoadOutcome {
    if (!isSafeSessionId(id)) {
      return {
        status: 'corrupt',
        issues: [{ path: '', message: 'the file name is not a usable session id' }],
      };
    }
    return this.records.listed(id);
  }

  /** Deletes session `id`'s record, holding its writer marker: refused while another writer holds it. */
  delete(id: string): void {
    assertSafeSessionId(id);
    this.records.delete(id, () => {
      this.sessions.deleteFile(`${id}.json`, 'delete project session record');
    });
  }

  /**
   * A session rebuilt from its replay log, read with the sealing this store keeps its records with.
   * A log it cannot read is reported like a snapshot it cannot read: `locked` (so a listing counts
   * it), `corrupt` with fixed text for a sealed line or a payload that does not open or match, and
   * `unsupported` for a line a newer build sealed — never a crashed listing and never `missing`.
   */
  private loadFromReplayLog(id: string): TSessionLoadOutcome {
    try {
      const record = this.reconstructReplayLog(id);
      if (record === undefined) return { status: 'missing' };
      // A log rebuilds only the session it names: one copied under another id's name is not that
      // session's, the same rule a snapshot whose record names another id is held to.
      if (record.id !== id) return OTHER_ID_LOG_OUTCOME;
      return asValidatedOutcome(record);
    } catch (error) {
      if (isArtifactLockedError(error)) {
        return (error as { readonly reason?: unknown }).reason === 'no-keys'
          ? NO_KEYS_LOG_OUTCOME
          : LOCKED_LOG_OUTCOME;
      }
      if (isArtifactCorruptError(error)) return SEALED_LINE_DOES_NOT_OPEN_OUTCOME;
      if (error instanceof SessionLogPayloadResolutionError) return PAYLOAD_UNREADABLE_OUTCOME;
      if (!(error instanceof SessionLogDecodeError)) throw error;
      if (error.code === 'UNSUPPORTED_VERSION') {
        return { status: 'unsupported', schemaVersion: error.schemaVersion };
      }
      return { status: 'corrupt', issues: error.issues };
    }
  }

  private reconstructReplayLog(id: string): IInteractiveSessionRecord | undefined {
    const replay = replaySessionLogEntries(
      loadSessionLogEntries(
        new WorkspaceSessionLogSource(this.logs, id, { sealing: this.sealing }),
      ),
    );
    if (!replay.sessionId || replay.messages.length === 0) return undefined;
    const backgroundTaskEvents = replay.backgroundTaskEvents as TBackgroundTaskEvent[];
    const backgroundJobGroupEvents = replay.backgroundJobGroupEvents as TBackgroundJobGroupEvent[];
    return {
      id: replay.sessionId,
      cwd: replay.cwd ?? '',
      createdAt: replay.createdAt ?? replay.updatedAt ?? new Date(0).toISOString(),
      updatedAt: replay.updatedAt ?? replay.createdAt ?? new Date(0).toISOString(),
      messages: replay.messages,
      history: replay.history,
      backgroundTasks: deriveBackgroundTasks(backgroundTaskEvents),
      backgroundTaskEvents,
      backgroundJobGroups: deriveBackgroundJobGroups(backgroundJobGroupEvents),
      backgroundJobGroupEvents,
      skillActivationEvents: [],
      memoryEvents: replay.memoryEvents as IMemoryEvent[],
    };
  }

  private listReplayLogIds(): string[] {
    return this.logs
      .listDirectory('', 'list project session logs')
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name.slice(0, -'.jsonl'.length));
  }
}
