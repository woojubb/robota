/**
 * TRANS-005 (#2081) — decoders for the three in-flight artifacts a session record persists so they
 * survive a resume: the autonomous goal, the plan artifact, and the active-branch pointer.
 *
 * The branch pointer is pure data by design — it names a `branchId`/`checkpointId` that live in a
 * separate manifest store, and a pointer into a manifest that no longer holds them is a RESUME
 * concern, not a decode one. This decoder therefore validates the pointer's shape and says nothing
 * about whether it resolves.
 */

import { atKey, setOptional } from './decode-outcome.js';
import {
  decodeArray,
  decodeDeclaredObject,
  decodeInteger,
  decodeLiteral,
  decodeOptional,
  decodeString,
  decodeTimestampString,
} from './scalars.js';

import type { TDecodeIssues } from './decode-outcome.js';
import type {
  IActiveBranchPointer,
  IGoalProgressEntry,
  IGoalState,
  IPlanArtifact,
  IPlanStep,
  TGoalStatus,
  TGoalStopReason,
  TPlanPhase,
  TPlanStepStatus,
} from '@robota-sdk/agent-interface-transport';

const GOAL_STATUSES = ['active', 'satisfied', 'stopped'] as const satisfies readonly TGoalStatus[];

const GOAL_STOP_REASONS = [
  'satisfied',
  'max-iterations',
  'cancelled',
  'no-progress',
] as const satisfies readonly TGoalStopReason[];

const GOAL_SIGNALS = [
  'continue',
  'satisfied',
] as const satisfies readonly IGoalProgressEntry['signal'][];

const PLAN_STEP_STATUSES = [
  'pending',
  'in-progress',
  'done',
] as const satisfies readonly TPlanStepStatus[];

const PLAN_PHASES = [
  'planning',
  'awaiting-approval',
  'executing',
  'completed',
] as const satisfies readonly TPlanPhase[];

function decodeGoalProgressEntry(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IGoalProgressEntry | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['iteration', 'signal', 'reason']);
  if (raw === undefined) return undefined;
  const iteration = decodeInteger(raw['iteration'], atKey(path, 'iteration'), issues);
  const signal = decodeLiteral(raw['signal'], GOAL_SIGNALS, atKey(path, 'signal'), issues);
  const reason = decodeString(raw['reason'], atKey(path, 'reason'), issues);
  if (iteration === undefined || signal === undefined || reason === undefined) return undefined;
  return { iteration, signal, reason };
}

export function decodeGoalState(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IGoalState | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'id',
    'objective',
    'status',
    'stopReason',
    'iterations',
    'maxIterations',
    'startedAt',
    'progress',
  ]);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const objective = decodeString(raw['objective'], atKey(path, 'objective'), issues);
  const status = decodeLiteral(raw['status'], GOAL_STATUSES, atKey(path, 'status'), issues);
  const iterations = decodeInteger(raw['iterations'], atKey(path, 'iterations'), issues);
  const maxIterations = decodeInteger(raw['maxIterations'], atKey(path, 'maxIterations'), issues);
  const startedAt = decodeTimestampString(raw['startedAt'], atKey(path, 'startedAt'), issues);
  const progress = decodeArray(
    raw['progress'],
    atKey(path, 'progress'),
    issues,
    decodeGoalProgressEntry,
  );
  if (
    id === undefined ||
    objective === undefined ||
    status === undefined ||
    iterations === undefined ||
    maxIterations === undefined ||
    startedAt === undefined ||
    progress === undefined
  ) {
    return undefined;
  }
  const goal: IGoalState = {
    id,
    objective,
    status,
    iterations,
    maxIterations,
    startedAt,
    progress,
  };
  setOptional(
    goal,
    'stopReason',
    decodeOptional(
      raw['stopReason'],
      atKey(path, 'stopReason'),
      issues,
      (member, memberPath, sink) => decodeLiteral(member, GOAL_STOP_REASONS, memberPath, sink),
    ),
  );
  return goal;
}

function decodePlanStep(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IPlanStep | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['id', 'description', 'status']);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const description = decodeString(raw['description'], atKey(path, 'description'), issues);
  const status = decodeLiteral(raw['status'], PLAN_STEP_STATUSES, atKey(path, 'status'), issues);
  if (id === undefined || description === undefined || status === undefined) return undefined;
  return { id, description, status };
}

export function decodePlanArtifact(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IPlanArtifact | undefined {
  const raw = decodeDeclaredObject(value, path, issues, [
    'id',
    'objective',
    'steps',
    'phase',
    'createdAt',
    'approvedAt',
  ]);
  if (raw === undefined) return undefined;
  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const objective = decodeString(raw['objective'], atKey(path, 'objective'), issues);
  const steps = decodeArray(raw['steps'], atKey(path, 'steps'), issues, decodePlanStep);
  const phase = decodeLiteral(raw['phase'], PLAN_PHASES, atKey(path, 'phase'), issues);
  const createdAt = decodeTimestampString(raw['createdAt'], atKey(path, 'createdAt'), issues);
  if (
    id === undefined ||
    objective === undefined ||
    steps === undefined ||
    phase === undefined ||
    createdAt === undefined
  ) {
    return undefined;
  }
  const plan: IPlanArtifact = { id, objective, steps, phase, createdAt };
  setOptional(
    plan,
    'approvedAt',
    decodeOptional(raw['approvedAt'], atKey(path, 'approvedAt'), issues, decodeTimestampString),
  );
  return plan;
}

export function decodeActiveBranchPointer(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IActiveBranchPointer | undefined {
  const raw = decodeDeclaredObject(value, path, issues, ['branchId', 'checkpointId']);
  if (raw === undefined) return undefined;
  const branchId = decodeString(raw['branchId'], atKey(path, 'branchId'), issues);
  const checkpointId = decodeString(raw['checkpointId'], atKey(path, 'checkpointId'), issues);
  if (branchId === undefined || checkpointId === undefined) return undefined;
  return { branchId, checkpointId };
}
