/**
 * UI-agnostic "ask the user" contract (CMD-004).
 *
 * The SSOT for the interaction action lives in agent-core so every interaction *source* can reach it:
 * command execution (`ICommandHostContext`, agent-framework) AND tool execution
 * (`IToolExecutionContext`, agent-core, for model-issued questions — CMD-005). These are pure types
 * with no runtime dependency, so the contract crosses a serialization/transport boundary unchanged
 * (no function-valued fields).
 *
 * A single shape covers every interaction kind, parameterised by fields rather than split into
 * variants:
 * - confirm    → two options, `maxSelect` 1
 * - single     → options, `maxSelect` 1
 * - multi      → options, `maxSelect` > 1
 * - free text  → no options, `allowFreeText` true
 * - secret     → free text with `masked` true
 */

/** One predefined option the user can choose. */
export interface IActionOption {
  value: string;
  label: string;
  description?: string;
}

/** Pre-selected option values and/or prefilled free text for an action request. */
export interface IActionDefault {
  values?: readonly string[];
  text?: string;
}

/** One request for the user to answer. See the module doc for how the fields encode each kind. */
export interface IActionRequest {
  /** Correlation key; the ask port resolves a given id exactly once (idempotent, first-answer wins). */
  id: string;
  title: string;
  description?: string;
  /** Predefined options. Empty/omitted ⇒ pure free-text entry. */
  options?: readonly IActionOption[];
  /** Minimum selections required (default 1). */
  minSelect?: number;
  /** Maximum selections allowed (default 1 ⇒ single; > 1 ⇒ multi). */
  maxSelect?: number;
  /** Allow a typed custom answer in addition to / instead of the options. */
  allowFreeText?: boolean;
  /** Free-text entry is masked (secret entry such as an API key); the renderer hides input. */
  masked?: boolean;
  /** Allow submitting empty free text. */
  allowEmpty?: boolean;
  /** Placeholder shown in the free-text field. */
  placeholder?: string;
  /** Maximum options shown before scrolling (renderer hint). */
  maxVisible?: number;
  /** Pre-selected option values and/or prefilled free text. */
  default?: IActionDefault;
}

/**
 * The user's answer to an {@link IActionRequest}. `answer` carries the selected option values and/or
 * the typed text; `cancelled` means the user dismissed the request, or no interactive renderer was
 * available to answer it.
 */
export type TActionResponse =
  | { type: 'answer'; values: readonly string[]; text?: string }
  | { type: 'cancelled' };

/**
 * The injected "ask the user" port — a single seam reachable by every interaction source (command
 * execution now; tool execution for model-issued questions later) and rendered per-environment by each
 * transport. The concurrency model (broadcast to attached interactive channels, first answer wins,
 * later answers for an already-resolved `id` ignored) is owned by the port implementation, not the
 * contract.
 */
export interface IUserInteraction {
  ask(request: IActionRequest): Promise<TActionResponse>;
}
