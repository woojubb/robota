import { join } from 'node:path';

import {
  loadSessionLogEntries,
  replaySessionLogEntries,
  SessionStore,
  type ISessionRecord,
} from '@robota-sdk/agent-session';

import { NodeFileSystem } from '../adapters/node-file-system.js';
import { projectPaths, userPaths } from '../paths.js';

import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '../background-tasks/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';
import type { IHistoryEntry, TUniversalMessage } from '@robota-sdk/agent-core';
// Session persistence contracts SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
} from '@robota-sdk/agent-interface-transport';

export type { IInteractiveSessionRecord, IInteractiveSessionStore, IResumableSessionSummary };

export function createProjectSessionStore(
  cwd: string,
  fs: IFileSystem = new NodeFileSystem(),
): IInteractiveSessionStore {
  const paths = projectPaths(cwd);
  return new ProjectSessionStoreFacade(paths.sessions, paths.logs, fs);
}

/**
 * User-level session store (`~/.robota/sessions`). Symmetric to {@link createProjectSessionStore};
 * there is no user-level replay-log directory, so it reads persisted records only.
 */
export function createUserSessionStore(
  fs: IFileSystem = new NodeFileSystem(),
): IInteractiveSessionStore {
  return new ProjectSessionStoreFacade(userPaths().sessions, undefined, fs);
}

export function listResumableSessionSummaries(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): IResumableSessionSummary[] {
  return (sessionStore?.list() ?? [])
    .filter((session) => session.cwd === cwd)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((session) => ({
      id: session.id,
      ...(session.name !== undefined ? { name: session.name } : {}),
      cwd: session.cwd,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      preview: getLastAssistantPreview(session.messages),
    }));
}

export function resolveLatestSessionId(
  sessionStore: IInteractiveSessionStore | undefined,
  cwd: string,
): string | undefined {
  return listResumableSessionSummaries(sessionStore, cwd)[0]?.id;
}

export function resolveSessionIdByIdOrName(
  sessionStore: IInteractiveSessionStore | undefined,
  idOrName: string,
): string | undefined {
  const match = (sessionStore?.list() ?? []).find(
    (session) => session.id === idOrName || session.name === idOrName,
  );
  return match?.id;
}

class ProjectSessionStoreFacade implements IInteractiveSessionStore {
  private readonly store: SessionStore;
  private readonly logsDir: string | undefined;
  private readonly fs: IFileSystem;

  constructor(baseDir: string, logsDir?: string, fs: IFileSystem = new NodeFileSystem()) {
    this.store = new SessionStore(baseDir);
    this.logsDir = logsDir;
    this.fs = fs;
  }

  save(session: IInteractiveSessionRecord): void {
    this.store.save(toSessionRecord(session));
  }

  load(id: string): IInteractiveSessionRecord | undefined {
    const session = this.store.load(id);
    if (session !== undefined) {
      return fromSessionRecord(session);
    }
    return this.loadFromReplayLog(id);
  }

  list(): IInteractiveSessionRecord[] {
    const records = this.store.list().map(fromSessionRecord);
    const seen = new Set(records.map((record) => record.id));
    for (const replayRecord of this.listReplayLogRecords()) {
      if (!seen.has(replayRecord.id)) {
        records.push(replayRecord);
      }
    }
    return records.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  private loadFromReplayLog(id: string): IInteractiveSessionRecord | undefined {
    if (!this.logsDir) return undefined;
    const replay = replaySessionLogEntries(
      loadSessionLogEntries(join(this.logsDir, `${id}.jsonl`)),
    );
    if (!replay.sessionId || replay.messages.length === 0) {
      return undefined;
    }
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
    if (!this.logsDir || !this.fs.existsSync(this.logsDir)) {
      return [];
    }
    return this.fs
      .readdirSync(this.logsDir)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => this.loadFromReplayLog(file.slice(0, -'.jsonl'.length)))
      .filter((record): record is IInteractiveSessionRecord => record !== undefined);
  }
}

function getLastAssistantPreview(messages: readonly TUniversalMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    if (typeof message.content !== 'string') continue;
    return message.content.replace(/[\n\r]+/g, ' ').trim();
  }
  return '';
}

function toSessionRecord(session: IInteractiveSessionRecord): ISessionRecord {
  return { ...session };
}

function fromSessionRecord(session: ISessionRecord): IInteractiveSessionRecord {
  return {
    id: session.id,
    ...(session.name !== undefined ? { name: session.name } : {}),
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages as TUniversalMessage[],
    ...(session.history !== undefined ? { history: session.history as IHistoryEntry[] } : {}),
    ...(session.systemPrompt !== undefined ? { systemPrompt: session.systemPrompt } : {}),
    ...(session.toolSchemas !== undefined ? { toolSchemas: session.toolSchemas } : {}),
    ...(session.backgroundTasks !== undefined
      ? { backgroundTasks: session.backgroundTasks as IBackgroundTaskState[] }
      : {}),
    ...(session.backgroundTaskEvents !== undefined
      ? { backgroundTaskEvents: session.backgroundTaskEvents as TBackgroundTaskEvent[] }
      : {}),
    ...(session.backgroundJobGroups !== undefined
      ? { backgroundJobGroups: session.backgroundJobGroups as IBackgroundJobGroupState[] }
      : {}),
    ...(session.backgroundJobGroupEvents !== undefined
      ? { backgroundJobGroupEvents: session.backgroundJobGroupEvents as TBackgroundJobGroupEvent[] }
      : {}),
    ...(session.skillActivationEvents !== undefined
      ? { skillActivationEvents: session.skillActivationEvents as ISkillActivationEvent[] }
      : {}),
    ...(session.memoryEvents !== undefined
      ? { memoryEvents: session.memoryEvents as IMemoryEvent[] }
      : {}),
    ...(session.usedMemoryReferences !== undefined
      ? { usedMemoryReferences: session.usedMemoryReferences as IMemoryReference[] }
      : {}),
    ...(session.contextReferences !== undefined
      ? { contextReferences: session.contextReferences as IContextReferenceItem[] }
      : {}),
    ...(session.sandboxSnapshotId !== undefined
      ? { sandboxSnapshotId: session.sandboxSnapshotId }
      : {}),
  };
}

function deriveBackgroundTasks(events: readonly TBackgroundTaskEvent[]): IBackgroundTaskState[] {
  const tasks = new Map<string, IBackgroundTaskState>();
  for (const event of events) {
    const task = getBackgroundTaskSnapshot(event);
    if (task) tasks.set(task.id, task);
  }
  return [...tasks.values()];
}

function getBackgroundTaskSnapshot(event: TBackgroundTaskEvent): IBackgroundTaskState | undefined {
  switch (event.type) {
    case 'background_task_created':
    case 'background_task_started':
    case 'background_task_updated':
    case 'background_task_completed':
    case 'background_task_failed':
    case 'background_task_cancelled':
      return event.task;
    default:
      return undefined;
  }
}

function deriveBackgroundJobGroups(
  events: readonly TBackgroundJobGroupEvent[],
): IBackgroundJobGroupState[] {
  const groups = new Map<string, IBackgroundJobGroupState>();
  for (const event of events) {
    groups.set(event.group.id, event.group);
  }
  return [...groups.values()];
}
