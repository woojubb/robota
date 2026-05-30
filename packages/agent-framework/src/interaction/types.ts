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

/** Framework-level permission request (id used to correlate with permission-resolved). */
export interface IPermissionRequest {
  id: string;
  toolName: string;
  toolArgs: unknown;
}

/** Request-response contract for disambiguation dialogs. */
export type IActionRequest =
  | { type: 'pick'; id: string; title: string; items: IPickItem[]; defaultIndex?: number }
  | { type: 'confirm'; id: string; message: string; defaultValue?: boolean };

export type IActionResponse =
  | { type: 'pick'; item: IPickItem }
  | { type: 'confirm'; confirmed: boolean }
  | { type: 'cancelled' };

export interface IPickItem {
  label: string;
  value: string;
  description?: string;
}

export interface ICommandInfo {
  name: string;
  description: string;
  subcommands?: ICommandInfo[];
}

/** Declared by command modules; consumed by createInteractiveRuntime to call requestAction. */
export type ICommandInteractionHint =
  | { type: 'pick'; getItems(): IPickItem[] }
  | { type: 'confirm'; message: string };
