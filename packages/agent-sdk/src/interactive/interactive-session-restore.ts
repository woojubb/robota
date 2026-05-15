/**
 * Session restore helpers for InteractiveSession.
 *
 * Handles message injection into an existing session and loading a persisted
 * session record back into the tracker state on resume/fork.
 */

import type { Session } from '@robota-sdk/agent-sessions';
import type { TUniversalMessage, IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
  TBackgroundTaskStatus,
} from '../background-tasks/index.js';
import type { IInteractiveSessionStore } from './session-persistence.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';

/** Inject a saved message into a session, supporting all roles including 'tool'. */
export function injectSavedMessage(session: Session, msg: TUniversalMessage): void {
  if (typeof msg.content !== 'string') return;
  if (msg.role === 'tool') {
    session.injectMessage('tool', msg.content, {
      toolCallId: msg.toolCallId,
      ...(msg.name !== undefined ? { name: msg.name } : {}),
    });
  } else {
    session.injectMessage(msg.role, msg.content);
  }
}

/**
 * Restore session history and messages from a persisted session record.
 * Returns the loaded history and any pending messages that need injection once session is ready.
 */
export function loadSessionRecord(
  sessionStore: IInteractiveSessionStore,
  resumeSessionId: string,
  forkSession: boolean,
  existingSession: Session | null,
): {
  history: IHistoryEntry[];
  sessionName: string | undefined;
  pendingRestoreMessages: TUniversalMessage[] | null;
  backgroundTasks: IBackgroundTaskState[];
  backgroundTaskEvents: TBackgroundTaskEvent[];
  backgroundJobGroups: IBackgroundJobGroupState[];
  backgroundJobGroupEvents: TBackgroundJobGroupEvent[];
  skillActivationEvents: ISkillActivationEvent[];
  memoryEvents: IMemoryEvent[];
  usedMemoryReferences: IMemoryReference[];
  contextReferences: IContextReferenceItem[];
  sandboxSnapshotId: string | undefined;
} {
  const record = sessionStore.load(resumeSessionId);
  if (!record) {
    return {
      history: [],
      sessionName: undefined,
      pendingRestoreMessages: null,
      backgroundTasks: [],
      backgroundTaskEvents: [],
      backgroundJobGroups: [],
      backgroundJobGroupEvents: [],
      skillActivationEvents: [],
      memoryEvents: [],
      usedMemoryReferences: [],
      contextReferences: [],
      sandboxSnapshotId: undefined,
    };
  }

  const history = record.history ?? [];
  const restoredBackgroundTasks = record.backgroundTasks ?? [];
  const restoredBackgroundTaskEvents = record.backgroundTaskEvents ?? [];
  const backgroundJobGroups = record.backgroundJobGroups ?? [];
  const backgroundJobGroupEvents = record.backgroundJobGroupEvents ?? [];
  const skillActivationEvents = record.skillActivationEvents ?? [];
  const memoryEvents = record.memoryEvents ?? [];
  const usedMemoryReferences = record.usedMemoryReferences ?? [];
  const contextReferences = record.contextReferences ?? [];
  const sandboxSnapshotId = record.sandboxSnapshotId;
  const { backgroundTasks, backgroundTaskEvents } = reconcileRestoredBackgroundTasks(
    restoredBackgroundTasks,
    restoredBackgroundTaskEvents,
  );
  const sessionName = record.name;
  let pendingRestoreMessages: TUniversalMessage[] | null = null;

  if (!forkSession && record.messages) {
    if (existingSession) {
      for (const msg of record.messages) {
        injectSavedMessage(existingSession, msg);
      }
    } else {
      pendingRestoreMessages = record.messages;
    }
  }

  return {
    history,
    sessionName,
    pendingRestoreMessages,
    backgroundTasks,
    backgroundTaskEvents,
    backgroundJobGroups,
    backgroundJobGroupEvents,
    skillActivationEvents,
    memoryEvents,
    usedMemoryReferences,
    contextReferences,
    sandboxSnapshotId,
  };
}

function reconcileRestoredBackgroundTasks(
  tasks: IBackgroundTaskState[],
  events: TBackgroundTaskEvent[],
): { backgroundTasks: IBackgroundTaskState[]; backgroundTaskEvents: TBackgroundTaskEvent[] } {
  const now = new Date().toISOString();
  const syntheticEvents: TBackgroundTaskEvent[] = [];
  const backgroundTasks = tasks.map((task) => {
    if (isRestoredTerminalStatus(task.status)) return task;
    const reconciled: IBackgroundTaskState = {
      ...task,
      status: 'failed',
      timeoutReason: 'stale_worker',
      error: {
        category: 'timeout',
        message: 'Restored background task is stale; worker cannot be reattached',
        recoverable: true,
      },
      unread: true,
      completedAt: now,
      updatedAt: now,
    };
    syntheticEvents.push({ type: 'background_task_failed', task: reconciled });
    return reconciled;
  });
  return {
    backgroundTasks,
    backgroundTaskEvents: [...events, ...syntheticEvents],
  };
}

function isRestoredTerminalStatus(status: TBackgroundTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
