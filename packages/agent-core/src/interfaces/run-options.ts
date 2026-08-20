import type { TTextDeltaCallback, TToolChoice } from './provider';
import type { TMetadata } from './types';
import type { TStructuredOutputSchema } from '../schema/structured-output';

/**
 * The per-RUN contract: what one `run()` may override or observe, as distinct from the agent's
 * standing configuration in `IAgentConfig`.
 *
 * Split out of `agent.ts` when PEER-007 added `driverId`. That file sits at a frozen size baseline,
 * and the anti-monolith rule asks for a split rather than one more field on a file already at its
 * limit. The two execution-event types come along because `onExecutionEvent` is their only consumer
 * — leaving them behind would have made this module import back from `agent.ts`.
 */

export type TExecutionEventData = Record<string, unknown>;

export type TExecutionEventCallback = (event: string, data: TExecutionEventData) => void;

/**
 * Agent run options - type-safe interface for all agent execution options
 */
export interface IRunOptions {
  /** Run-scoped temperature override — wins over `defaultModel.temperature` (CORE-016). */
  temperature?: number;
  /** Run-scoped max output tokens override — wins over `defaultModel.maxTokens` (CORE-016). */
  maxTokens?: number;
  /**
   * Run-scoped tool-invocation directive — wins over `defaultModel.toolChoice` (CORE-017).
   * `'auto'` (model decides), `'none'` (suppress tool calls), `'required'` (must call some
   * tool), or `{ tool: name }` (must call the named tool; the name is validated against the
   * run's tool list and a miss throws). Forcing applies to the run's first model call only;
   * rounds after tool results revert to `'auto'` (see `TToolChoice`).
   */
  toolChoice?: TToolChoice;
  sessionId?: string;
  userId?: string;
  /**
   * PEER-007 (issue #1915): who this run is attributed to, for display. Per-run because it changes
   * per turn — one session serves the operator and any peer addressing it. Never authorization.
   */
  driverId?: string;
  metadata?: TMetadata;
  /**
   * Run-scoped EPHEMERAL system context (SELFHOST-008 P3). A transient system-role block included in THIS
   * run's provider request(s) only — it is **never written to the conversation store** and never persisted,
   * so it does not bloat history or force a static-system-prompt rebuild. Content-free neutral channel: the
   * caller decides what to put here (e.g. per-turn recalled memory). Absent ⇒ no change.
   */
  ephemeralSystemContext?: string;
  /** AbortSignal for cancelling execution */
  signal?: AbortSignal;
  /** Per-run streaming text callback. Prefer this over mutating provider callback state. */
  onTextDelta?: TTextDeltaCallback;
  /** Per-run replay event callback for provider/tool execution boundaries. */
  onExecutionEvent?: TExecutionEventCallback;
  /**
   * Maximum execution rounds for this run. A **round** is one provider (model) call plus the
   * execution of every tool call that reply requested; a reply with no tool calls ends the loop,
   * so a plain Q&A turn is exactly 1 round. This caps model/tool cycles within ONE `run()` — it is
   * not a tool-count limit and not a multi-turn conversation limit. When the cap is hit the run
   * stops after the current round. Use 0 for no core round cap. Defaults to
   * `IAgentConfig.maxExecutionRounds`.
   */
  maxExecutionRounds?: number;
  /** Max times the same tool may be called with identical input before aborting. Unset = no limit. */
  maxSameToolInputs?: number;
  /**
   * Treat a turn that ends in tool calls (no trailing text) as a valid completion instead of
   * forcing one extra provider call to generate a summary (CORE-011). For decision-agent patterns
   * (router/orchestrator/classifier) the tool call IS the answer — this removes the one-call tax.
   * The run result's content may be empty; consumers read the outcome from the tool results.
   */
  allowToolOnlyCompletion?: boolean;
  /**
   * Schema-enforced structured output (CORE-015). Accepts a Zod schema or an explicit
   * `{ jsonSchema }` wrapper. `run` then resolves to the validated, typed object instead of a
   * string: the schema is forwarded to the provider's native structured-output surface where one
   * exists, and the final response is always parsed and validated core-side; a violation triggers
   * a bounded retry with the validation issues fed back as the next turn's input. Every attempt is
   * a real conversation turn (history stays append-only). Exhausted retries throw
   * `StructuredOutputError`.
   */
  output?: TStructuredOutputSchema;
  /**
   * Retry budget for structured output validation failures — the number of additional attempts
   * after the first (default 2). Only meaningful with `output` set.
   */
  outputRetries?: number;
}
