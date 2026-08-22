import {
  assertSafeSessionId,
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
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-transport';

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
    this.sessions.writeText(
      `${session.id}.json`,
      JSON.stringify(session, null, 2),
      'persist project session record',
    );
  }

  load(id: string): IInteractiveSessionRecord | undefined {
    assertSafeSessionId(id);
    const raw = this.sessions.readText(`${id}.json`, 'load project session record');
    if (raw !== undefined) {
      try {
        return JSON.parse(raw) as IInteractiveSessionRecord;
      } catch {
        // allow-fallback: corrupt session state is unrecoverable; the append-only log may recover it.
      }
    }
    return this.loadFromReplayLog(id);
  }

  list(): IInteractiveSessionRecord[] {
    const records = this.sessions
      .listDirectory('', 'list project session records')
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter(isSafeSessionId)
      .map((id) => this.load(id))
      .filter((record): record is IInteractiveSessionRecord => record !== undefined);
    const seen = new Set(records.map((record) => record.id));
    for (const replayRecord of this.listReplayLogRecords()) {
      if (!seen.has(replayRecord.id)) records.push(replayRecord);
    }
    return records.sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
  }

  delete(id: string): void {
    assertSafeSessionId(id);
    this.sessions.deleteFile(`${id}.json`, 'delete project session record');
  }

  private loadFromReplayLog(id: string): IInteractiveSessionRecord | undefined {
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

  private listReplayLogRecords(): IInteractiveSessionRecord[] {
    return this.logs
      .listDirectory('', 'list project session logs')
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name.slice(0, -'.jsonl'.length))
      .filter(isSafeSessionId)
      .map((id) => this.loadFromReplayLog(id))
      .filter((record): record is IInteractiveSessionRecord => record !== undefined);
  }
}
