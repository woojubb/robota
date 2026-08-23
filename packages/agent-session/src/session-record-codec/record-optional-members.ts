/**
 * TRANS-005 (#2081) — the optional members of a persisted session record.
 *
 * Written out one member at a time rather than driven from a key→decoder table. A table would be
 * shorter, but its entries decode to a union of every member type, so the assignment back onto the
 * record needs a cast — and a cast is what this whole codec exists to remove. Each statement below
 * is checked by the compiler against the contract member it fills.
 */

import { decodeBackgroundJobGroupEvent, decodeJobGroupState } from './background-group-decoders.js';
import { decodeBackgroundTaskState } from './background-task-decoders.js';
import { decodeBackgroundTaskEvent } from './background-task-event-decoders.js';
import { atKey, setOptional } from './decode-outcome.js';
import {
  decodeContextReferenceItem,
  decodeMemoryEvent,
  decodeMemoryReference,
  decodeSkillActivationEvent,
} from './event-decoders.js';
import {
  decodeActiveBranchPointer,
  decodeGoalState,
  decodePlanArtifact,
} from './goal-plan-branch-decoders.js';
import { decodeHistoryEntry } from './message-decoders.js';
import { decodeArray, decodeOptional, decodeString } from './scalars.js';
import { decodeToolSchema } from './tool-schema-decoders.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-transport';

/** Decode an optional array member: absent stays absent, present is decoded element by element. */
function optionalArray<TItem>(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  issues: TDecodeIssues,
  decodeItem: (value: unknown, path: string, issues: TDecodeIssues) => TItem | undefined,
): TItem[] | undefined {
  return decodeOptional(raw[key], atKey(path, key), issues, (member, memberPath, sink) =>
    decodeArray(member, memberPath, sink, decodeItem),
  );
}

/** Fill in every optional member of `record` from `raw`, recording any defect it finds. */
export function applyOptionalRecordMembers(
  record: IInteractiveSessionRecord,
  raw: Record<string, unknown>,
  path: string,
  issues: TDecodeIssues,
): void {
  for (const key of ['name', 'systemPrompt', 'sandboxSnapshotId'] as const) {
    setOptional(record, key, decodeOptional(raw[key], atKey(path, key), issues, decodeString));
  }

  setOptional(record, 'history', optionalArray(raw, 'history', path, issues, decodeHistoryEntry));
  setOptional(
    record,
    'toolSchemas',
    optionalArray(raw, 'toolSchemas', path, issues, decodeToolSchema),
  );
  setOptional(
    record,
    'backgroundTasks',
    optionalArray(raw, 'backgroundTasks', path, issues, decodeBackgroundTaskState),
  );
  setOptional(
    record,
    'backgroundTaskEvents',
    optionalArray(raw, 'backgroundTaskEvents', path, issues, decodeBackgroundTaskEvent),
  );
  setOptional(
    record,
    'backgroundJobGroups',
    optionalArray(raw, 'backgroundJobGroups', path, issues, decodeJobGroupState),
  );
  setOptional(
    record,
    'backgroundJobGroupEvents',
    optionalArray(raw, 'backgroundJobGroupEvents', path, issues, decodeBackgroundJobGroupEvent),
  );
  setOptional(
    record,
    'skillActivationEvents',
    optionalArray(raw, 'skillActivationEvents', path, issues, decodeSkillActivationEvent),
  );
  setOptional(
    record,
    'memoryEvents',
    optionalArray(raw, 'memoryEvents', path, issues, decodeMemoryEvent),
  );
  setOptional(
    record,
    'usedMemoryReferences',
    optionalArray(raw, 'usedMemoryReferences', path, issues, decodeMemoryReference),
  );
  setOptional(
    record,
    'contextReferences',
    optionalArray(raw, 'contextReferences', path, issues, decodeContextReferenceItem),
  );

  setOptional(
    record,
    'goal',
    decodeOptional(raw['goal'], atKey(path, 'goal'), issues, decodeGoalState),
  );
  setOptional(
    record,
    'plan',
    decodeOptional(raw['plan'], atKey(path, 'plan'), issues, decodePlanArtifact),
  );
  setOptional(
    record,
    'activeBranch',
    decodeOptional(
      raw['activeBranch'],
      atKey(path, 'activeBranch'),
      issues,
      decodeActiveBranchPointer,
    ),
  );
}
