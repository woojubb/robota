import type { IInteractiveSessionRecord, IInteractiveSessionStore } from './session-persistence.js';
import type {
  IBackgroundJobGroupState,
  TBackgroundJobGroupEvent,
} from '../background-tasks/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContextReferenceItem } from '../context/context-reference-inventory.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type {
  IGoalState,
  IPlanArtifact,
  IActiveBranchPointer,
} from '@robota-sdk/agent-interface-session';
import type { Session } from '@robota-sdk/agent-session';

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
  skillActivationState?: {
    events: readonly ISkillActivationEvent[];
  },
  contextReferenceState?: {
    references: readonly IContextReferenceItem[];
  },
  sandboxState?: {
    snapshotId?: string;
  },
  goalState?: IGoalState,
  planState?: IPlanArtifact,
  activeBranchState?: IActiveBranchPointer,
): void {
  try {
    const sessionId = session.getSessionId();
    // TRANS-007: this reads the stored record to preserve members it does not own, so a load that
    // failed for any reason OTHER than "no record" must not be treated as "no record" — writing
    // then replaces a file this build merely cannot read with a fresh one, and that file is the
    // only copy.
    const outcome = sessionStore.load(sessionId);
    if (outcome.status !== 'valid' && outcome.status !== 'missing') {
      return;
    }
    const existing = outcome.status === 'valid' ? outcome.record : undefined;
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
        skillActivationState,
        contextReferenceState,
        ...(sandboxSnapshotId !== undefined ? { sandboxSnapshotId } : {}),
        ...(goalState !== undefined ? { goalState } : {}),
        ...(planState !== undefined ? { planState } : {}),
        ...(activeBranchState !== undefined ? { activeBranchState } : {}),
      }),
    );
  } catch {
    // allow-fallback: persistence is best-effort for interactive execution and must not break a turn
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
  skillActivationState?: {
    events: readonly ISkillActivationEvent[];
  };
  contextReferenceState?: {
    references: readonly IContextReferenceItem[];
  };
  sandboxSnapshotId?: string;
  goalState?: IGoalState;
  planState?: IPlanArtifact;
  activeBranchState?: IActiveBranchPointer;
}

function buildInteractiveSessionRecord(
  input: IBuildInteractiveSessionRecordInput,
): IInteractiveSessionRecord {
  return {
    id: input.sessionId,
    ...(input.goalState !== undefined ? { goal: input.goalState } : {}),
    ...(input.planState !== undefined ? { plan: input.planState } : {}),
    ...(input.activeBranchState !== undefined ? { activeBranch: input.activeBranchState } : {}),
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
    ...buildSkillActivationRecordFields(input.skillActivationState),
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

function buildSkillActivationRecordFields(
  state: IBuildInteractiveSessionRecordInput['skillActivationState'],
): Partial<IInteractiveSessionRecord> {
  if (!state) return {};
  return { skillActivationEvents: [...state.events] };
}

function buildContextReferenceRecordFields(
  state: IBuildInteractiveSessionRecordInput['contextReferenceState'],
): Partial<IInteractiveSessionRecord> {
  if (!state) return {};
  return { contextReferences: [...state.references] };
}
