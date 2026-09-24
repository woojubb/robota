/**
 * ToolExecutionService owned events.
 * Local event names only (no dots). Full names are composed at emit time.
 *
 * Extracted from `tool-execution-service.ts` into a leaf module: `plugins/event-emitter/types.ts`
 * needs only these constants, not the rest of the service module (which imports plugin/manager
 * interfaces) — importing the whole module there created a module-level import cycle.
 * `tool-execution-service.ts` re-exports these names, so existing imports are unaffected.
 */
export const TOOL_EVENTS = {
  CALL_START: 'call_start',
  CALL_COMPLETE: 'call_complete',
  CALL_ERROR: 'call_error',
  CALL_RESPONSE_READY: 'call_response_ready',
} as const;

export const TOOL_EVENT_PREFIX = 'tool' as const;

export const UNKNOWN_TOOL_ERROR_CODE = 'unknown_tool' as const;

/**
 * A tool call's arguments failed to decode to a JSON object (invalid JSON, or a non-object root).
 * Marks a per-call batch outcome the same way `UNKNOWN_TOOL_ERROR_CODE` marks a tool the call named
 * that was never invoked — the request is refused before reaching the tool, and the batch's other
 * requests are unaffected.
 */
export const ARGUMENT_DECODE_ERROR_CODE = 'argument_decode_error' as const;
