/**
 * Session restore helpers for InteractiveSession.
 *
 * Handles message injection into an existing session and loading a persisted
 * session record back into the tracker state on resume/fork.
 */

import type { IInteractiveSessionStore } from './session-persistence.js';
import type {
  IBackgroundJobGroupState,
  TBackgroundJobGroupEvent,
} from '../background-tasks/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { TUniversalMessage, IHistoryEntry } from '@robota-sdk/agent-core';
import type { IGoalState } from '@robota-sdk/agent-interface-transport';
import type {
  IBackgroundTaskState,
  TBackgroundTaskEvent,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

/** Inject a saved message into a session, preserving all fields including toolCalls. */
export function injectSavedMessage(session: Session, msg: TUniversalMessage): void {
  session.injectRawMessage(msg);
}

/**
 * Restore session history and messages from a persisted session record.
 * Returns the loaded history and any pending messages that need injection once session is ready.
 */
export function loadSessionRecord(
  sessionStore: IInteractiveSessionStore,
  resumeSessionId: string,
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
  goal: IGoalState | undefined;
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
      goal: undefined,
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

  // CLI-073: forks restore the conversation too — the SPEC promises
  // "new session (fresh UUID) but restores context"; only the session id is new.
  if (record.messages) {
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
    goal: record.goal,
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
    // FLOW-003: a sleeping scheduled wake that carries a reconstructable schedule is re-armed
    // (re-spawned) by the background tracker on subscribe — keep it as-is rather than failing it.
    if (isReArmableSchedule(task)) return task;
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

/** FLOW-003: a restored sleeping scheduled task that can be re-armed from its persisted schedule. */
function isReArmableSchedule(task: IBackgroundTaskState): boolean {
  return task.kind === 'scheduled' && task.status === 'sleeping' && task.schedule !== undefined;
}
