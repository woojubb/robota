import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type { JsonValue, ParticipantCheckpoint } from '@robota-sdk/agent-roundtable';
import { RobotaParticipantError } from './errors';

export const ROBOTA_SESSION_CHECKPOINT_VERSION = 'robota-session/1';

/** Private state `sessionParticipant` checkpoints at a settled turn boundary or a parked wait. */
export interface SessionCheckpointState {
  sessionId: string;
  cwd: string;
  firstTurnDone: boolean;
  /** Full private history at a settled boundary; `null` while parked on a wait (see SPEC). */
  history: TUniversalMessage[] | null;
  /** The Session-level execution a parked wait belongs to, and its ordered request ids. */
  pending: { executionId: string; requestIds: string[] } | null;
}

function invalid(field: string): never {
  throw new RobotaParticipantError('checkpoint-invalid', `Checkpoint field is invalid: ${field}`);
}

/** JSON plus `Date`, round-tripped through a tagged `{ $date }` marker — never a bare object shape. */
function encodeValue(value: unknown): JsonValue {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = encodeValue(entry);
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  throw new RobotaParticipantError(
    'checkpoint-invalid',
    `Cannot encode a ${typeof value} value into a checkpoint`,
  );
}

function isDateMarker(value: JsonValue): value is { $date: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { $date?: unknown }).$date === 'string'
  );
}

function decodeValue(value: JsonValue): unknown {
  if (isDateMarker(value)) {
    const date = new Date(value.$date);
    if (Number.isNaN(date.getTime())) invalid('$date');
    return date;
  }
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = decodeValue(entry);
    return out;
  }
  return value;
}

export function encodeMessage(message: TUniversalMessage): JsonValue {
  return encodeValue(message);
}

export function decodeMessage(value: JsonValue): TUniversalMessage {
  const decoded = decodeValue(value);
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    typeof (decoded as Record<string, unknown>).id !== 'string' ||
    typeof (decoded as Record<string, unknown>).role !== 'string' ||
    typeof (decoded as Record<string, unknown>).state !== 'string' ||
    !((decoded as Record<string, unknown>).timestamp instanceof Date)
  )
    invalid('history message');
  return decoded as unknown as TUniversalMessage;
}

/** Encode {@link SessionCheckpointState} as a `robota-session/1` {@link ParticipantCheckpoint}. */
export function encodeSessionCheckpoint(state: SessionCheckpointState): ParticipantCheckpoint {
  return {
    version: ROBOTA_SESSION_CHECKPOINT_VERSION,
    data: {
      sessionId: state.sessionId,
      cwd: state.cwd,
      firstTurnDone: state.firstTurnDone,
      history: state.history ? state.history.map(encodeMessage) : null,
      pending: state.pending
        ? { executionId: state.pending.executionId, requestIds: [...state.pending.requestIds] }
        : null,
    },
  };
}

/** Decode a `robota-session/1` checkpoint; any other version or a malformed shape is rejected. */
export function decodeSessionCheckpoint(checkpoint: ParticipantCheckpoint): SessionCheckpointState {
  if (checkpoint.version !== ROBOTA_SESSION_CHECKPOINT_VERSION)
    throw new RobotaParticipantError(
      'checkpoint-invalid',
      `Unsupported checkpoint version: ${checkpoint.version}`,
    );
  const data = checkpoint.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) invalid('data');
  const { sessionId, cwd, firstTurnDone, history, pending } = data as Record<string, JsonValue>;
  if (typeof sessionId !== 'string' || !sessionId) invalid('sessionId');
  if (typeof cwd !== 'string' || !cwd) invalid('cwd');
  if (typeof firstTurnDone !== 'boolean') invalid('firstTurnDone');

  let decodedHistory: TUniversalMessage[] | null;
  if (history === null) decodedHistory = null;
  else if (Array.isArray(history)) decodedHistory = history.map(decodeMessage);
  else invalid('history');

  let decodedPending: SessionCheckpointState['pending'];
  if (pending === null) decodedPending = null;
  else if (pending && typeof pending === 'object' && !Array.isArray(pending)) {
    const { executionId, requestIds } = pending as Record<string, JsonValue>;
    if (typeof executionId !== 'string' || !executionId) invalid('pending.executionId');
    if (!Array.isArray(requestIds) || !requestIds.every((id) => typeof id === 'string'))
      invalid('pending.requestIds');
    decodedPending = { executionId, requestIds: requestIds as string[] };
  } else invalid('pending');

  return { sessionId, cwd, firstTurnDone, history: decodedHistory, pending: decodedPending };
}

export const ROBOTA_AGENT_CHECKPOINT_VERSION = 'robota-agent/1';

/** Encode a `robotaParticipant` Robota agent's full history as a `robota-agent/1` checkpoint. */
export function encodeAgentCheckpoint(
  history: readonly TUniversalMessage[],
): ParticipantCheckpoint {
  return { version: ROBOTA_AGENT_CHECKPOINT_VERSION, data: history.map(encodeMessage) };
}

/** Decode a `robota-agent/1` checkpoint back into its history array. */
export function decodeAgentCheckpoint(checkpoint: ParticipantCheckpoint): TUniversalMessage[] {
  if (checkpoint.version !== ROBOTA_AGENT_CHECKPOINT_VERSION)
    throw new RobotaParticipantError(
      'checkpoint-invalid',
      `Unsupported checkpoint version: ${checkpoint.version}`,
    );
  if (!Array.isArray(checkpoint.data)) invalid('data');
  return checkpoint.data.map(decodeMessage);
}
