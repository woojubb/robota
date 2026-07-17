import type { IBaseEventData } from './interfaces.js';

/**
 * SELFHOST-004: per-operation span lifecycle event names. Mirrors the `TASK_EVENTS`/`USER_EVENTS`
 * pattern (a const name set + a prefix). The local name is distinctive (`span_completed`, not a bare
 * `completed`) so a consumer can identify a span-completion regardless of the emitting owner's prefix.
 */
export const SPAN_EVENTS = {
  COMPLETED: 'span_completed',
} as const;

export const SPAN_EVENT_PREFIX = 'span' as const;

export type TSpanEvent = (typeof SPAN_EVENTS)[keyof typeof SPAN_EVENTS];

/**
 * SELFHOST-004: span-completion event payload — JOINS the span id with its measured duration and the
 * operation name (raw scalars ONLY; references no transport type). Emitted by the per-operation timing
 * source (e.g. `FunctionTool`) so a consuming layer (`agent-framework`) can build a record span entry
 * WITHOUT `agent-core` depending on `agent-interface-transport` (no cycle). The `spanId` also rides the
 * emitting event's `IEventContext` (so the two agree), correlatable to the owning turn via `ownerPath`.
 */
export interface ISpanCompletionEventData extends IBaseEventData {
  /** The span id (equals the emitted event's context `spanId`). */
  spanId: string;
  /** Measured wall-clock duration of the operation, in milliseconds. */
  durationMs: number;
  /** The operation name (e.g. the tool name). */
  op: string;
}
