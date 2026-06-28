/**
 * INFRA-017: typed contract for session-log event names + replay keys (SSOT).
 *
 * The `FileSessionLogger` writes JSONL lines `{ timestamp, sessionId, event, ...data }`. The event
 * names were previously implicit string literals scattered across the session/execution code. This
 * module names them once so the writer, the replay validator (`session-log-validation.ts`), and the
 * session-log replay provider (INFRA-017 / TEST-008) share one type-safe schema — without changing
 * what is written (it formalizes the existing format, it does not add a new one).
 *
 * The **replay substrate** is the provider/tool execution layer, keyed deterministically:
 * a `provider_request` (executionId + round) is answered by its recorded
 * `provider_native_raw_payload` / `provider_response_normalized`; a `tool_execution_request`
 * (executionId + toolCallId) by its `tool_execution_result`. `validateSessionReplayLogEntries`
 * proves a log carries all of these (i.e. is replay-complete).
 */

/** Canonical session-log event names. */
export const SESSION_LOG_EVENT = {
  // Session lifecycle / context
  sessionInit: 'session_init',
  sessionShutdown: 'session_shutdown',
  context: 'context',
  contextCompact: 'context_compact',
  error: 'error',

  // Canonical conversation substrate (resume): history mutations append messages.
  historyMutation: 'history_mutation',

  // Provider replay substrate (keyed by executionId + round).
  providerRequest: 'provider_request',
  providerNativeRawPayload: 'provider_native_raw_payload',
  providerResponseRaw: 'provider_response_raw',
  providerResponseNormalized: 'provider_response_normalized',

  // Tool replay substrate (keyed by executionId + toolCallId).
  toolExecutionRequest: 'tool_execution_request',
  toolExecutionResult: 'tool_execution_result',

  // Observability (display/debug; not the replay substrate).
  user: 'user',
  preRun: 'pre_run',
  textDelta: 'text_delta',
  assistant: 'assistant',
  toolCall: 'tool_call',
  toolResult: 'tool_result',
  toolBlocked: 'tool_blocked',
  toolDenied: 'tool_denied',
  serverTool: 'server_tool',
} as const;

export type TSessionLogEventName = (typeof SESSION_LOG_EVENT)[keyof typeof SESSION_LOG_EVENT];

/** Common envelope written for every line by `FileSessionLogger`. */
export interface ISessionLogLine {
  readonly timestamp: string;
  readonly sessionId: string;
  readonly event: string;
  readonly [key: string]: unknown;
}

/** Replay correlation key for a provider call. */
export interface IProviderEventKey {
  readonly executionId: string;
  readonly round: number;
}

/** Replay correlation key for a tool execution. */
export interface IToolEventKey {
  readonly executionId: string;
  readonly toolCallId: string;
}

/** Narrow a raw log line to a specific event name. */
export function isSessionLogEvent<TName extends TSessionLogEventName>(
  line: ISessionLogLine,
  name: TName,
): line is ISessionLogLine & { event: TName } {
  return line.event === name;
}
