/**
 * Session restore helpers for InteractiveSession.
 *
 * Handles message injection into an existing session and loading a persisted
 * session record back into the tracker state on resume/fork.
 */

import { isReArmableScheduledTask } from './schedule-rearm.js';

import type { IInteractiveSessionStore, TSessionLoadOutcome } from './session-persistence.js';
import type {
  IBackgroundJobGroupState,
  TBackgroundJobGroupEvent,
} from '../background-tasks/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { TUniversalMessage, IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskState,
  TBackgroundTaskEvent,
  TBackgroundTaskStatus,
} from '@robota-sdk/agent-interface-execution';
import type {
  IGoalState,
  IPlanArtifact,
  IActiveBranchPointer,
} from '@robota-sdk/agent-interface-session';
import type { Session } from '@robota-sdk/agent-session';

/** Inject a saved message into a session, preserving all fields including toolCalls. */
export function injectSavedMessage(session: Session, msg: TUniversalMessage): void {
  session.injectRawMessage(msg);
}

/**
 * Restore session history and messages from a persisted session record.
 *
 * Returns the loaded history, any pending messages that need injection once the session is ready,
 * and — since TRANS-007 — WHY the record is empty when it is empty.
 *
 * The empty shape used to be returned for every failure: a damaged file produced a result
 * indistinguishable from a brand-new session, and the user saw their conversation, goal, plan and
 * branch pointer silently absent with nothing said. `loadOutcome` carries the store's verdict so a
 * surface can tell "there was nothing to restore" from "there is something here this build cannot
 * read", which are different sentences to show a person.
 */
export function loadSessionRecord(
  sessionStore: IInteractiveSessionStore,
  resumeSessionId: string,
  existingSession: Session | null,
): {
  /** TRANS-007: what the store concluded. `missing` is a new session; the rest are not. */
  loadOutcome: TSessionLoadOutcome;
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
  plan: IPlanArtifact | undefined;
  activeBranch: IActiveBranchPointer | undefined;
  /**
   * CLI-1994: the ASSEMBLED system message the record was persisted with. Every persist writes it
   * (`interactive-session-persistence.ts`) and, until this item, nothing read it back. A fork
   * inherits it verbatim — that is what "a copy of the conversation" means for the prompt half.
   * `undefined` for a record written without one, which then rebuilds the prompt as before.
   */
  restoredSystemPrompt: string | undefined;
} {
  const outcome = sessionStore.load(resumeSessionId);
  if (outcome.status !== 'valid') {
    return {
      loadOutcome: outcome,
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
      plan: undefined,
      activeBranch: undefined,
      restoredSystemPrompt: undefined,
    };
  }
  const record = outcome.record;

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
    loadOutcome: outcome,
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
    plan: record.plan,
    activeBranch: record.activeBranch,
    restoredSystemPrompt: record.systemPrompt,
  };
}

/** What {@link restoreSessionRecordIntoSession} did to the session it was handed. */
export interface ISessionRecordRestoreResult {
  /** Whether the record carried a system prompt and the session now runs under it. */
  readonly systemPromptRestored: boolean;
}

/**
 * CLI-1994: restore a persisted record into an ALREADY CONSTRUCTED session — the path a subagent
 * runner takes for a fork job, in this process or in a child process.
 *
 * The runner receives only `resumeSessionId` (ARCH-044: the conversation never crosses the wire);
 * this is where the id becomes the conversation. It is the same injection the startup fork uses
 * (`loadSessionRecord` over an existing session), plus the prompt half: the child inherits the
 * parent's ASSEMBLED system message rather than the subagent prompt it was constructed with.
 *
 * A record the store cannot hand back is a failure of the job, stated as such. Starting the child
 * empty in that case would be a fork that silently forgot its parent, which is the one outcome a
 * caller of this function has no way to detect.
 */
export function restoreSessionRecordIntoSession(
  sessionStore: IInteractiveSessionStore,
  resumeSessionId: string,
  session: Session,
): ISessionRecordRestoreResult {
  const restored = loadSessionRecord(sessionStore, resumeSessionId, session);
  if (restored.loadOutcome.status !== 'valid') {
    throw new Error(
      `Cannot resume session ${resumeSessionId}: the session store reported ` +
        `"${restored.loadOutcome.status}" for its record.`,
    );
  }
  if (restored.restoredSystemPrompt !== undefined) {
    session.updateSystemMessage(restored.restoredSystemPrompt);
  }
  session.syncContextFromHistory();
  return { systemPromptRestored: restored.restoredSystemPrompt !== undefined };
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
    if (isReArmableScheduledTask(task)) return task;
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
