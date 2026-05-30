import type { InteractionEvent, IActionRequest, IActionResponse, ICommandInfo } from './types.js';

export interface IInteractionChannel {
  /** Framework registers input handler. Channel calls it when user submits text. */
  onSubmit(handler: (text: string) => Promise<void>): void;

  /** Framework pushes one-way display events. Fire-and-forget. */
  write(event: InteractionEvent): void;

  /**
   * Framework requests user disambiguation. Channel decides HOW to present it
   * (Ink dialog, web modal, programmatic preset). Resolves when user responds.
   */
  requestAction(action: IActionRequest): Promise<IActionResponse>;

  /** Framework provides registered slash commands for autocomplete. */
  setAvailableCommands(commands: ICommandInfo[]): void;

  /** Signal whether session is busy (channel may disable input). */
  setBusy(busy: boolean): void;

  start(): Promise<void>;
  stop(): Promise<void>;
}
