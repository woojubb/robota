import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { Session } from '@robota-sdk/agent-sessions';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '../background-tasks/index.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IInteractiveSessionRecord, IInteractiveSessionStore } from './session-persistence.js';

/**
 * Persist the current session state to the session store.
 * Silently ignores errors because persistence failure must not break execution.
 */
export function persistSession(
  sessionStore: IInteractiveSessionStore,
  session: Session,
  sessionName: string | undefined,
  cwd: string,
  history: IHistoryEntry[],
  backgroundState?: {
    tasks: readonly IBackgroundTaskState[];
    events: readonly TBackgroundTaskEvent[];
    groups?: readonly IBackgroundJobGroupState[];
    groupEvents?: readonly TBackgroundJobGroupEvent[];
  },
  memoryState?: {
    events: readonly IMemoryEvent[];
    usedReferences: readonly IMemoryReference[];
  },
  contextReferenceState?: {
    references: readonly IContextReferenceItem[];
  },
  sandboxState?: {
    snapshotId?: string;
  },
): void {
  try {
    const sessionId = session.getSessionId();
    const existing = sessionStore.load(sessionId);
    const sandboxSnapshotId = sandboxState?.snapshotId ?? existing?.sandboxSnapshotId;
    sessionStore.save(
      buildInteractiveSessionRecord({
        session,
        sessionId,
        sessionName: sessionName ?? existing?.name,
        cwd,
        history,
        createdAt: existing?.createdAt,
        backgroundState,
        memoryState,
        contextReferenceState,
        ...(sandboxSnapshotId !== undefined ? { sandboxSnapshotId } : {}),
      }),
    );
  } catch {
    // Persistence is best-effort for interactive execution.
  }
}

interface IBuildInteractiveSessionRecordInput {
  session: Session;
  sessionId: string;
  sessionName?: string;
  cwd: string;
  history: IHistoryEntry[];
  createdAt?: string;
  backgroundState?: {
    tasks: readonly IBackgroundTaskState[];
    events: readonly TBackgroundTaskEvent[];
    groups?: readonly IBackgroundJobGroupState[];
    groupEvents?: readonly TBackgroundJobGroupEvent[];
  };
  memoryState?: {
    events: readonly IMemoryEvent[];
    usedReferences: readonly IMemoryReference[];
  };
  contextReferenceState?: {
    references: readonly IContextReferenceItem[];
  };
  sandboxSnapshotId?: string;
}

function buildInteractiveSessionRecord(
  input: IBuildInteractiveSessionRecordInput,
): IInteractiveSessionRecord {
  return {
    id: input.sessionId,
    ...(input.sessionName !== undefined ? { name: input.sessionName } : {}),
    cwd: input.cwd,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: input.session.getHistory(),
    history: input.history,
    systemPrompt: input.session.getSystemMessage(),
    toolSchemas: input.session.getToolSchemas(),
    ...(input.sandboxSnapshotId !== undefined
      ? { sandboxSnapshotId: input.sandboxSnapshotId }
      : {}),
    ...buildBackgroundRecordFields(input.backgroundState),
    ...buildMemoryRecordFields(input.memoryState),
    ...buildContextReferenceRecordFields(input.contextReferenceState),
  };
}

function buildBackgroundRecordFields(
  state: IBuildInteractiveSessionRecordInput['backgroundState'],
): Partial<IInteractiveSessionRecord> {
  if (!state) return {};
  return {
    backgroundTasks: [...state.tasks],
    backgroundTaskEvents: [...state.events],
    backgroundJobGroups: [...(state.groups ?? [])],
    backgroundJobGroupEvents: [...(state.groupEvents ?? [])],
  };
}

function buildMemoryRecordFields(
  state: IBuildInteractiveSessionRecordInput['memoryState'],
): Partial<IInteractiveSessionRecord> {
  if (!state) return {};
  return {
    memoryEvents: [...state.events],
    usedMemoryReferences: [...state.usedReferences],
  };
}

function buildContextReferenceRecordFields(
  state: IBuildInteractiveSessionRecordInput['contextReferenceState'],
): Partial<IInteractiveSessionRecord> {
  if (!state) return {};
  return { contextReferences: [...state.references] };
}
