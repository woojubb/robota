/**
 * INFRA-017: typed contract for session-log event names + replay keys (SSOT).
 *
 * `FileSessionLogger` owns the `{ schemaVersion, timestamp, sessionId, event }` JSONL envelope.
 * This module owns its version and event vocabulary; `session-log-codec` validates each payload
 * before replay or completeness checks.
 *
 * The **replay substrate** is the provider/tool execution layer, keyed deterministically:
 * a `provider_request` (executionId + round) is answered by its recorded
 * `provider_native_raw_payload` / `provider_response_normalized`; a `tool_execution_request`
 * (executionId + toolCallId) by its `tool_execution_result`. `validateSessionReplayLogEntries`
 * proves a log carries all of these (i.e. is replay-complete).
 */

/** Supported persisted session-log envelope version. */
export const SESSION_LOG_SCHEMA_VERSION = 1;

/** Canonical session-log event names. */
export const SESSION_LOG_EVENT = {
  // Session lifecycle / context
  sessionInit: 'session_init',
  sessionShutdown: 'session_shutdown',
  sessionShutdownStepError: 'session_shutdown_step_error',
  context: 'context',
  contextCompact: 'context_compact',
  error: 'error',

  // Canonical conversation substrate (resume): history mutations append messages.
  historyMutation: 'history_mutation',

  // Provider replay substrate (keyed by executionId + round).
  providerRequest: 'provider_request',
  providerNativeRawPayload: 'provider_native_raw_payload',
  providerStreamRawDelta: 'provider_stream_raw_delta',
  providerResponseRaw: 'provider_response_raw',
  providerResponseNormalized: 'provider_response_normalized',
  /**
   * CORE-043: which transport actually carried a structured-output schema on this request, and
   * whether the schema had to be stated in the prompt instead. Diagnostic, not replay substrate — a
   * replay answers a `provider_request` from its recorded response, and this line explains why that
   * request looked the way it did.
   */
  structuredOutputTransport: 'structured_output_transport',
  /**
   * A request moved to another model because the one it was on failed. Diagnostic, not replay
   * substrate: the `provider_request` announced for the new model is what a replay answers.
   */
  providerFallback: 'provider_fallback',
  assistantMessageCommitted: 'assistant_message_committed',

  // Tool replay substrate (keyed by executionId + toolCallId).
  toolExecutionRequest: 'tool_execution_request',
  toolExecutionResult: 'tool_execution_result',
  toolBatchStarted: 'tool_batch_started',
  toolMessageCommitted: 'tool_message_committed',

  // Runtime state persisted beside the conversation substrate.
  backgroundTaskEvent: 'background_task_event',
  backgroundJobGroupEvent: 'background_job_group_event',
  memoryEvent: 'memory_event',

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
