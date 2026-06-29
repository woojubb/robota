/**
 * ProgrammaticInteractionChannel — an in-process IInteractionChannel adapter (INFRA-019).
 *
 * The "programmatic preset" adapter slot reserved by the interaction contract: instead of an Ink TUI
 * or a print runner, this channel lets a caller push a message in-process and read back the structured
 * `InteractionEvent` stream the framework already emits. It uses the documented one-way `write()`
 * protocol consumed by `createInteractiveRuntime` (not the TUI's direct-wiring path).
 *
 * Production transport adapter — lives in transport core. Tests and automation consume it; it never
 * depends on test code.
 */

import type { IActionRequest, TActionResponse } from '@robota-sdk/agent-core';
import type {
  IInteractionChannel,
  ICommandInfo,
  InteractionEvent,
} from '@robota-sdk/agent-interface-transport';

export class ProgrammaticInteractionChannel implements IInteractionChannel {
  /** Full structured event stream pushed by the framework, in order. */
  readonly events: InteractionEvent[] = [];

  availableCommands: ICommandInfo[] = [];
  busy = false;
  started = false;
  stopped = false;

  private submitHandler: ((text: string) => Promise<void>) | null = null;
  private readonly userActionResponses: TActionResponse[] = [];

  // ── IInteractionChannel ──────────────────────────────────────

  onSubmit(handler: (text: string) => Promise<void>): void {
    this.submitHandler = handler;
  }

  write(event: InteractionEvent): void {
    this.events.push(event);
  }

  /**
   * CMD-004 unified ask. Resolves from the pre-supplied queue (FIFO); an empty queue resolves
   * `{ type: 'cancelled' }` so a programmatic run never blocks on an un-answered question.
   */
  async askUser(_request: IActionRequest): Promise<TActionResponse> {
    return this.userActionResponses.shift() ?? { type: 'cancelled' };
  }

  setAvailableCommands(commands: ICommandInfo[]): void {
    this.availableCommands = commands;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  // ── Programmatic driving surface ─────────────────────────────

  /** Push a user submission into the framework (the programmatic "user types and presses enter"). */
  async submit(text: string): Promise<void> {
    if (!this.submitHandler) {
      throw new Error(
        'ProgrammaticInteractionChannel: no submit handler registered — start the runtime first',
      );
    }
    await this.submitHandler(text);
  }

  /** Pre-answer the next `askUser` (CMD-004 unified ask). */
  queueUserAction(response: TActionResponse): void {
    this.userActionResponses.push(response);
  }
}
