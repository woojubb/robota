import type { IHistoryEntry, IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import { SessionStore, type ISessionRecord } from '@robota-sdk/agent-sessions';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '../background-tasks/index.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import { projectPaths } from '../paths.js';

export interface IInteractiveSessionRecord {
  id: string;
  name?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: TUniversalMessage[];
  history?: IHistoryEntry[];
  systemPrompt?: string;
  toolSchemas?: IToolSchema[];
  backgroundTasks?: IBackgroundTaskState[];
  backgroundTaskEvents?: TBackgroundTaskEvent[];
  backgroundJobGroups?: IBackgroundJobGroupState[];
  backgroundJobGroupEvents?: TBackgroundJobGroupEvent[];
  memoryEvents?: IMemoryEvent[];
  usedMemoryReferences?: IMemoryReference[];
  contextReferences?: IContextReferenceItem[];
}

export interface IInteractiveSessionStore {
  save(session: IInteractiveSessionRecord): void;
  load(id: string): IInteractiveSessionRecord | undefined;
  list(): IInteractiveSessionRecord[];
  delete(id: string): void;
}

export interface IResumableSessionSummary {
  id: string;
  name?: string;
  cwd: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

export function createProjectSessionStore(cwd: string): IInteractiveSessionStore {
  return new ProjectSessionStoreFacade(projectPaths(cwd).sessions);
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

  constructor(baseDir: string) {
    this.store = new SessionStore(baseDir);
  }

  save(session: IInteractiveSessionRecord): void {
    this.store.save(toSessionRecord(session));
  }

  load(id: string): IInteractiveSessionRecord | undefined {
    const session = this.store.load(id);
    return session === undefined ? undefined : fromSessionRecord(session);
  }

  list(): IInteractiveSessionRecord[] {
    return this.store.list().map(fromSessionRecord);
  }

  delete(id: string): void {
    this.store.delete(id);
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
    ...(session.memoryEvents !== undefined
      ? { memoryEvents: session.memoryEvents as IMemoryEvent[] }
      : {}),
    ...(session.usedMemoryReferences !== undefined
      ? { usedMemoryReferences: session.usedMemoryReferences as IMemoryReference[] }
      : {}),
    ...(session.contextReferences !== undefined
      ? { contextReferences: session.contextReferences as IContextReferenceItem[] }
      : {}),
  };
}
