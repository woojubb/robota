import type { TBackgroundPrimitive } from '@robota-sdk/agent-executor';
// Execution-workspace contracts SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
import type {
  IExecutionOrigin,
  IExecutionWorkspaceEntryRef,
} from '@robota-sdk/agent-interface-transport';

export type {
  TExecutionEntryKind,
  TExecutionWorkspaceStatus,
  TExecutionAttention,
  TExecutionWorkspaceVisibility,
  TExecutionControl,
  TExecutionOriginKind,
  TExecutionDetailRecordKind,
  TExecutionWorkspaceUpdateCause,
  IExecutionOrigin,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceFilter,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  IExecutionWorkspaceEvent,
  IExecutionDetailCursor,
  IExecutionDetailRecord,
  IExecutionDetailPage,
  ICreateMainThreadEntryInput,
  ICreateExecutionWorkspaceSnapshotInput,
  IExecutionWorkspaceEntryRef,
  ICreateMainThreadDetailPageInput,
  ICreateLineDetailPageInput,
} from '@robota-sdk/agent-interface-transport';

export const MAIN_THREAD_ENTRY_PREFIX = 'main';
export const BACKGROUND_TASK_ENTRY_PREFIX = 'task';
export const BACKGROUND_GROUP_ENTRY_PREFIX = 'group';
export const ENTRY_ID_SEPARATOR = ':';

export const EXECUTION_ORIGIN_METADATA_KEYS = {
  kind: 'executionOriginKind',
  sessionId: 'executionOriginSessionId',
  turnId: 'executionOriginTurnId',
  commandName: 'executionOriginCommandName',
  toolCallId: 'executionOriginToolCallId',
  skillId: 'executionOriginSkillId',
  label: 'executionOriginLabel',
} as const;

export function createMainThreadExecutionEntryId(sessionId: string): string {
  return [MAIN_THREAD_ENTRY_PREFIX, sessionId].join(ENTRY_ID_SEPARATOR);
}

export function createBackgroundTaskExecutionEntryId(taskId: string): string {
  return [BACKGROUND_TASK_ENTRY_PREFIX, taskId].join(ENTRY_ID_SEPARATOR);
}

export function createBackgroundGroupExecutionEntryId(groupId: string): string {
  return [BACKGROUND_GROUP_ENTRY_PREFIX, groupId].join(ENTRY_ID_SEPARATOR);
}

export function parseExecutionWorkspaceEntryId(
  entryId: string,
): IExecutionWorkspaceEntryRef | undefined {
  const [prefix, sourceId] = entryId.split(ENTRY_ID_SEPARATOR, 2);
  if (!sourceId) return undefined;
  if (prefix === MAIN_THREAD_ENTRY_PREFIX) return { kind: 'main_thread', sourceId };
  if (prefix === BACKGROUND_TASK_ENTRY_PREFIX) return { kind: 'background_task', sourceId };
  if (prefix === BACKGROUND_GROUP_ENTRY_PREFIX) return { kind: 'background_group', sourceId };
  return undefined;
}

export function createExecutionOriginMetadata(
  origin: IExecutionOrigin,
): Record<string, TBackgroundPrimitive> {
  return {
    [EXECUTION_ORIGIN_METADATA_KEYS.kind]: origin.kind,
    [EXECUTION_ORIGIN_METADATA_KEYS.sessionId]: origin.sessionId,
    ...(origin.turnId ? { [EXECUTION_ORIGIN_METADATA_KEYS.turnId]: origin.turnId } : {}),
    ...(origin.commandName
      ? { [EXECUTION_ORIGIN_METADATA_KEYS.commandName]: origin.commandName }
      : {}),
    ...(origin.toolCallId
      ? { [EXECUTION_ORIGIN_METADATA_KEYS.toolCallId]: origin.toolCallId }
      : {}),
    ...(origin.skillId ? { [EXECUTION_ORIGIN_METADATA_KEYS.skillId]: origin.skillId } : {}),
    ...(origin.label ? { [EXECUTION_ORIGIN_METADATA_KEYS.label]: origin.label } : {}),
  };
}
