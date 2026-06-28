/**
 * Interaction-channel contracts — the request/response and display-event surface
 * between the assembly layer and transport channels.
 *
 * SSOT shared by agent-framework (createInteractiveRuntime) and agent-transport channels.
 */

/** Framework-level permission request (id used to correlate with permission-resolved). */
export interface IPermissionRequest {
  id: string;
  toolName: string;
  toolArgs: unknown;
}

/** One-way display events pushed by the framework to the channel. */
export type InteractionEvent =
  | { type: 'user-message'; text: string }
  | { type: 'assistant-chunk'; chunk: string }
  | { type: 'assistant-done'; fullText: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'tool-result'; id: string; name: string; result: unknown }
  | { type: 'permission-request'; request: IPermissionRequest }
  | { type: 'permission-resolved'; id: string; granted: boolean }
  | { type: 'command-result'; name: string; output: string }
  | { type: 'error'; error: Error };

export interface IPickItem {
  label: string;
  value: string;
  description?: string;
}

/** Request-response contract for disambiguation dialogs. */
export type TActionRequest =
  | { type: 'pick'; id: string; title: string; items: IPickItem[]; defaultIndex?: number }
  | { type: 'confirm'; id: string; message: string; defaultValue?: boolean };

export type TActionResponse =
  | { type: 'pick'; item: IPickItem }
  | { type: 'confirm'; confirmed: boolean }
  | { type: 'cancelled' };

export interface ICommandInfo {
  name: string;
  description: string;
  subcommands?: ICommandInfo[];
}

/** Declared by command modules; consumed by createInteractiveRuntime to call requestAction. */
export type TCommandInteractionHint =
  | { type: 'pick'; getItems(): IPickItem[] }
  | { type: 'confirm'; message: string };

export interface IInteractionChannel {
  /** Framework registers input handler. Channel calls it when user submits text. */
  onSubmit(handler: (text: string) => Promise<void>): void;

  /** Framework pushes one-way display events. Fire-and-forget. */
  write(event: InteractionEvent): void;

  /**
   * Framework requests user disambiguation. Channel decides HOW to present it
   * (Ink dialog, web modal, programmatic preset). Resolves when user responds.
   */
  requestAction(action: TActionRequest): Promise<TActionResponse>;

  /** Framework provides registered slash commands for autocomplete. */
  setAvailableCommands(commands: ICommandInfo[]): void;

  /** Signal whether session is busy (channel may disable input). */
  setBusy(busy: boolean): void;

  start(): Promise<void>;
  stop(): Promise<void>;
}

/** A tool invocation observed from the interaction event stream. */
export interface IToolCallObservation {
  id: string;
  name: string;
  args: unknown;
}

/**
 * Client-side interaction contract — the **dual** of {@link IInteractionChannel}. Where
 * `IInteractionChannel` is what the framework *writes to*, `IAgentDriver` is what a **client** uses to
 * *drive* the agent and *observe* its event stream. Implemented by the in-process programmatic driver,
 * the remote client, and a built-binary test driver. Production-grade (embedding apps + the remote
 * client are non-test clients), so it lives next to the framework-side port as the same seam's other
 * face.
 *
 * Observation accessors are NOT methods that each adapter re-implements: an implementer exposes the raw
 * {@link events} stream and delegates the accessors to the shared `read*` helpers below, so the
 * filter/derivation logic exists exactly once.
 */
export interface IAgentDriver {
  /** Start the underlying session/transport. Idempotent — a second call is a no-op. */
  start(): Promise<void>;
  /**
   * Submit a user message. When called serially (await each `send`), resolves after the turn
   * completes; a `send` issued mid-turn is queued and resolves once that queued turn runs.
   */
  send(text: string): Promise<void>;
  /** Pre-answer the next disambiguation `requestAction`. */
  queueAction(response: TActionResponse): void;
  /** The structured event stream observed from the agent, in order. */
  readonly events: readonly InteractionEvent[];
  /** Every completed assistant reply (`assistant-done` fullTexts), in order. */
  assistantReplies(): string[];
  /** The most recent completed assistant reply, or `undefined` if none yet. */
  lastAssistantText(): string | undefined;
  /** Tool-call observations captured during the run. */
  toolCalls(): IToolCallObservation[];
  /** Errors surfaced by the framework during the run. */
  errors(): Error[];
  /** Stop the underlying session/transport. */
  stop(): Promise<void>;
}

// ── Shared pure accessors over an InteractionEvent stream ────────────────────────────────
// The single home for "what counts as a reply / tool call / error". Every IAgentDriver implementer
// delegates to these; no adapter re-implements the discriminated-union filters.

/** Completed assistant replies (`assistant-done` fullTexts), in order. */
export function readAssistantReplies(events: readonly InteractionEvent[]): string[] {
  return events
    .filter(
      (e): e is Extract<InteractionEvent, { type: 'assistant-done' }> =>
        e.type === 'assistant-done',
    )
    .map((e) => e.fullText);
}

/** The most recent completed assistant reply, or `undefined`. */
export function readLastAssistantText(events: readonly InteractionEvent[]): string | undefined {
  return readAssistantReplies(events).at(-1);
}

/** Tool-call observations, in order. */
export function readToolCalls(events: readonly InteractionEvent[]): IToolCallObservation[] {
  return events
    .filter((e): e is Extract<InteractionEvent, { type: 'tool-call' }> => e.type === 'tool-call')
    .map((e) => ({ id: e.id, name: e.name, args: e.args }));
}

/** Errors surfaced in the stream, in order. */
export function readErrors(events: readonly InteractionEvent[]): Error[] {
  return events
    .filter((e): e is Extract<InteractionEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.error);
}

/**
 * Terminal-handoff capability — a transport may optionally hand the real terminal to a child process
 * (interactive input + output via the real TTY) and restore its display afterward.
 *
 * Implemented by interactive transports (e.g. the TUI suspends/resumes its rendering); a headless
 * transport reports `canHandoffTerminal === false`. The contract is **platform-neutral** and never
 * spawns a shell itself — the caller's `fn` spawns whatever child it wants with inherited stdio.
 * (SSOT for the transport contract; agent-framework orchestrates and surfaces it to commands.)
 */
export interface ITerminalHandoff {
  /** Whether an interactive terminal handoff is actually possible (an interactive TTY is present). */
  readonly canHandoffTerminal: boolean;

  /**
   * Suspend the display, run `fn` (the caller spawns its child with inherited stdio), then restore
   * the display — including when `fn` throws. Rejects without running `fn` when
   * `canHandoffTerminal` is `false`.
   */
  runWithTerminal<T>(fn: () => Promise<T>): Promise<T>;
}
