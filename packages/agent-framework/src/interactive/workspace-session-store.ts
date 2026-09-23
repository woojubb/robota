import {
  SESSION_RECORD_ENVELOPE_VERSION,
  SessionLogDecodeError,
  assertSafeSessionId,
  decodeInteractiveSessionRecord,
  decodeVersionedInteractiveSessionRecord,
  isSafeSessionId,
  loadSessionLogEntries,
  replaySessionLogEntries,
} from '@robota-sdk/agent-session';

import { deriveBackgroundJobGroups, deriveBackgroundTasks } from './session-replay-state.js';
import { WorkspaceSessionLogSource } from './workspace-session-io.js';
import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import { assertWorkspaceProjectStateStoragePair } from '../workspace-trust/project-state-storage.js';

import type { IMemoryEvent } from '../memory/automatic-memory-types.js';
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type {
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListEntry,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

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

/** Decode stored bytes, keeping "not JSON" and "not a record" the same answer for the caller. */
function decodeStoredSessionText(raw: string): TSessionLoadOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { status: 'corrupt', issues: [{ path: '', message: 'the session file is not JSON' }] };
  }
  const outcome = decodeVersionedInteractiveSessionRecord(parsed);
  if (outcome.status === 'valid') return { status: 'valid', record: outcome.record };
  if (outcome.status === 'unsupported') {
    return { status: 'unsupported', schemaVersion: outcome.schemaVersion };
  }
  return { status: 'corrupt', issues: outcome.issues };
}

/** Project session record adapter backed only by runtime-minted state facets. */
export class WorkspaceProjectSessionStore implements IInteractiveSessionStore {
  private readonly sessions: IWorkspaceProjectStateStorage;
  private readonly logs: IWorkspaceProjectStateStorage;

  constructor(sessions: IWorkspaceProjectStateStorage, logs: IWorkspaceProjectStateStorage) {
    this.sessions = assertNamespace(sessions, 'sessions');
    this.logs = assertNamespace(logs, 'session-logs');
    assertWorkspaceProjectStateStoragePair(this.sessions, this.logs);
  }

  save(session: IInteractiveSessionRecord): void {
    assertSafeSessionId(session.id);
    // TRANS-007: the versioned envelope, the same shape the host store and the share artifact carry.
    this.sessions.writeText(
      `${session.id}.json`,
      JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record: session }, null, 2),
      'persist project session record',
    );
  }

  /**
   * Load a session, saying which of the four things happened.
   *
   * **The replay log runs for `missing` and only for `missing` (TRANS-007).** It used to run
   * whenever the parse failed, so a damaged snapshot was quietly replaced by a partial
   * reconstruction — no `goal`, no `plan`, no `activeBranch`, no `toolSchemas`, and no indication
   * that a more complete record was sitting on disk unreadable. Recovery is for absence; a damaged
   * record is reported.
   */
  load(id: string): TSessionLoadOutcome {
    assertSafeSessionId(id);
    const raw = this.sessions.readText(`${id}.json`, 'load project session record');
    if (raw !== undefined) {
      return decodeStoredSessionText(raw);
    }
    return this.loadFromReplayLog(id);
  }

  /**
   * Every session this project holds, each with what the store concluded about it.
   *
   * An entry it cannot read is REPORTED rather than filtered away — hiding two of four outcomes from
   * the surface a person browses moves the defect instead of removing it. Replay-only sessions
   * (a log with no snapshot) still appear, as they did before.
   */
  list(): readonly ISessionListEntry[] {
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
    return entries.sort((left, right) => recencyOf(right) - recencyOf(left));
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
    return this.load(id);
  }

  delete(id: string): void {
    assertSafeSessionId(id);
    this.sessions.deleteFile(`${id}.json`, 'delete project session record');
  }

  private loadFromReplayLog(id: string): TSessionLoadOutcome {
    try {
      const record = this.reconstructReplayLog(id);
      return record === undefined ? { status: 'missing' } : asValidatedOutcome(record);
    } catch (error) {
      if (!(error instanceof SessionLogDecodeError)) throw error;
      if (error.code === 'UNSUPPORTED_VERSION') {
        return { status: 'unsupported', schemaVersion: error.schemaVersion };
      }
      return { status: 'corrupt', issues: error.issues };
    }
  }

  private reconstructReplayLog(id: string): IInteractiveSessionRecord | undefined {
    const replay = replaySessionLogEntries(
      loadSessionLogEntries(new WorkspaceSessionLogSource(this.logs, id)),
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
