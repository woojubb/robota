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
