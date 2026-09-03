/**
 * Owner-side runtime decoders for the wire message unions (issue #2045 / TRANS-005 adjacent).
 *
 * `ws-protocol.ts` owns the TypeScript unions; this file owns turning `JSON.parse` output into one
 * of them. Before it, the server did `JSON.parse(data) as TClientMessage` and each client did the
 * same for `TServerMessage`, so valid JSON with an invalid shape crossed the boundary wearing a
 * protocol type. Carriers now implement `raw string → owner decoder → typed message` and answer a
 * refusal with the protocol's own `protocol_error` (server side) or client error (client side).
 *
 * `decodeClientMessage` is TOTAL: every variant and every nested field it carries is validated.
 * `decodeServerMessage` validates every variant's discriminator and declared top-level fields; a
 * payload OWNED BY ANOTHER PACKAGE (`IToolState`, `IExecutionResult`, background events, …) is
 * checked as a non-array record (or array of records) here — its own total decoding belongs to its
 * owner and is tracked there, not duplicated in a transport package.
 */

import type { TBackgroundControlAction, TClientMessage, TServerMessage } from './ws-protocol.js';

export type TMessageDecodeResult<TMessage> =
  | { readonly ok: true; readonly message: TMessage }
  | { readonly ok: false; readonly reason: string };

/** Serialized frames larger than this are refused before any parse (a bounded inbound budget). */
export const MAX_INBOUND_FRAME_BYTES = 4 * 1024 * 1024;

type TRecord = Record<string, unknown>;

function isRecord(value: unknown): value is TRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isString = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isOptional =
  (check: (v: unknown) => boolean) =>
  (v: unknown): boolean =>
    v === undefined || check(v);
const isRecordArray = (v: unknown): boolean => Array.isArray(v) && v.every(isRecord);
const isNullableRecord = (v: unknown): boolean => v === null || isRecord(v);
const oneOf =
  (members: readonly string[]) =>
  (v: unknown): boolean =>
    typeof v === 'string' && members.includes(v);

type TFieldCheck = (value: unknown) => boolean;
type TVariantShape = Readonly<Record<string, TFieldCheck>>;

const BACKGROUND_TASK_KINDS = ['agent', 'process', 'scheduled'] as const;
const BACKGROUND_TASK_MODES = ['foreground', 'background'] as const;
const BACKGROUND_TASK_STATUSES = [
  'queued',
  'running',
  'waiting_permission',
  'sleeping',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
const BACKGROUND_CONTROL_ACTIONS: readonly TBackgroundControlAction[] = ['cancel', 'close', 'send'];

const isBackgroundTaskListFilter: TFieldCheck = (v) =>
  isRecord(v) &&
  isOptional(oneOf(BACKGROUND_TASK_KINDS))(v['kind']) &&
  isOptional(oneOf(BACKGROUND_TASK_STATUSES))(v['status']) &&
  isOptional(oneOf(BACKGROUND_TASK_MODES))(v['mode']) &&
  isOptional(isBoolean)(v['includeClosed']);
const isBackgroundTaskInput: TFieldCheck = (v) =>
  isRecord(v) && isOptional(isString)(v['prompt']) && isOptional(isString)(v['stdin']);
const isBackgroundTaskLogCursor: TFieldCheck = (v) => isRecord(v) && isFiniteNumber(v['offset']);
const isPermissionResultValue: TFieldCheck = (v) =>
  isBoolean(v) || v === 'allow-session' || v === 'allow-project';
const isActionResponse: TFieldCheck = (v) =>
  isRecord(v) &&
  ((v['type'] === 'answer' &&
    Array.isArray(v['values']) &&
    v['values'].every(isString) &&
    isOptional(isString)(v['text'])) ||
    (v['type'] === 'cancelled' && v['values'] === undefined && v['text'] === undefined));

/** One entry per `TClientMessage` variant — a variant added to the union without one fails the test. */
export const CLIENT_MESSAGE_SHAPES: Readonly<Record<TClientMessage['type'], TVariantShape>> = {
  submit: { prompt: isNonEmptyString },
  command: { name: isNonEmptyString, args: isOptional(isString) },
  abort: {},
  'cancel-queue': {},
  'get-messages': {},
  'get-context': {},
  'get-usage-report': {},
  'get-executing': {},
  'get-pending': {},
  'get-execution-workspace': {},
  'get-background-tasks': { filter: isOptional(isBackgroundTaskListFilter) },
  'get-background-task': { taskId: isNonEmptyString },
  'get-background-job-groups': {},
  'get-background-job-group': { groupId: isNonEmptyString },
  'wait-background-job-group': { groupId: isNonEmptyString },
  'cancel-background-task': { taskId: isNonEmptyString, reason: isOptional(isString) },
  'close-background-task': { taskId: isNonEmptyString },
  'send-background-task': { taskId: isNonEmptyString, input: isBackgroundTaskInput },
  'read-background-task-log': {
    taskId: isNonEmptyString,
    cursor: isOptional(isBackgroundTaskLogCursor),
  },
  'permission-response': { id: isNonEmptyString, result: isPermissionResultValue },
  'ask-response': { id: isNonEmptyString, response: isActionResponse },
  resume: { lastSeq: isFiniteNumber },
  ack: { seq: isFiniteNumber },
};

const authored: TVariantShape = { driverId: isOptional(isString) };

/** One entry per `TServerMessage` variant. Foreign-owned payloads are checked as records (see header). */
export const SERVER_MESSAGE_SHAPES: Readonly<Record<TServerMessage['type'], TVariantShape>> = {
  text_delta: { delta: isString, ...authored },
  user_message: { content: isString, ...authored },
  tool_start: { state: isRecord, ...authored },
  tool_end: { state: isRecord, ...authored },
  thinking: { isThinking: isBoolean, ...authored },
  complete: { result: isRecord, ...authored },
  interrupted: { result: isRecord, ...authored },
  error: { message: isString, ...authored },
  command_result: { name: isString, message: isString, success: isBoolean },
  messages: { messages: isRecordArray },
  context: { state: isRecord },
  usage_report: { report: isRecord },
  executing: { executing: isBoolean },
  pending: { pending: (v) => v === null || isString(v) },
  execution_workspace_event: { snapshot: isRecord },
  background_task_event: { event: isRecord },
  background_job_group_event: { event: isRecord },
  plan_event: { event: isRecord },
  context_file_refreshed: { event: isRecord },
  branch_event: { event: isRecord },
  background_tasks: { tasks: isRecordArray },
  background_task: { taskId: isString, task: isNullableRecord },
  background_job_groups: { groups: isRecordArray },
  background_job_group: { groupId: isString, group: isNullableRecord },
  background_task_log: { taskId: isString, page: isRecord },
  permission_request: { event: isRecord },
  ask_request: { event: isRecord },
  prompt_resolved: { event: isRecord },
  ui_intent: { event: isRecord },
  session_renamed: { event: isRecord },
  history_cleared: {},
  background_task_control_result: {
    action: oneOf(BACKGROUND_CONTROL_ACTIONS),
    taskId: isString,
    success: isBoolean,
    message: isOptional(isString),
  },
  protocol_error: { message: isString },
  resume_gap: {},
};

function decodeVariant<TMessage extends { type: string }>(
  value: unknown,
  shapes: Readonly<Record<string, TVariantShape>>,
  reasonFor: (field: string) => string,
): TMessageDecodeResult<TMessage> {
  if (!isRecord(value)) return { ok: false, reason: 'message must be a JSON object' };
  const type = value['type'];
  if (!isString(type)) return { ok: false, reason: 'message type must be a string' };
  const shape = Object.prototype.hasOwnProperty.call(shapes, type) ? shapes[type] : undefined;
  if (shape === undefined) return { ok: false, reason: `Unknown message type: ${type}` };
  for (const [field, check] of Object.entries(shape)) {
    if (!check(value[field])) return { ok: false, reason: reasonFor(field) };
  }
  return { ok: true, message: value as unknown as TMessage };
}

/** Total decode of a parsed client frame. */
export function decodeClientMessage(value: unknown): TMessageDecodeResult<TClientMessage> {
  return decodeVariant<TClientMessage>(value, CLIENT_MESSAGE_SHAPES, (field) =>
    field === 'prompt' ? 'prompt must be a non-empty string' : `${field} has an invalid shape`,
  );
}

/** Variant-level decode of a parsed server frame (foreign-owned payloads as records, see header). */
export function decodeServerMessage(value: unknown): TMessageDecodeResult<TServerMessage> {
  return decodeVariant<TServerMessage>(
    value,
    SERVER_MESSAGE_SHAPES,
    (field) => `${field} has an invalid shape`,
  );
}

/** `raw string → JSON → owner decoder`, the one path a carrier implements. */
export function decodeFrame<TMessage>(
  data: string,
  decode: (value: unknown) => TMessageDecodeResult<TMessage>,
): TMessageDecodeResult<TMessage> {
  if (data.length > MAX_INBOUND_FRAME_BYTES) return { ok: false, reason: 'Frame too large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
    // allow-fallback: the parse failure is returned as a typed refusal the carrier answers on the wire
  } catch {
    return { ok: false, reason: 'Invalid JSON' };
  }
  return decode(parsed);
}
