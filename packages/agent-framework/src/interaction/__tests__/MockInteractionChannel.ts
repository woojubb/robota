import { vi } from 'vitest';

import type { IInteractionChannel } from '../IInteractionChannel.js';
import type { TActionRequest, TActionResponse, ICommandInfo, InteractionEvent } from '../types.js';

export class MockInteractionChannel implements IInteractionChannel {
  readonly events: InteractionEvent[] = [];
  readonly writtenEvents: InteractionEvent[] = [];
  readonly availableCommands: ICommandInfo[] = [];
  busyState = false;
  started = false;
  stopped = false;

  private submitHandler: ((text: string) => Promise<void>) | null = null;
  private actionResponse: TActionResponse = { type: 'cancelled' };

  onSubmit(handler: (text: string) => Promise<void>): void {
    this.submitHandler = handler;
  }

  write(event: InteractionEvent): void {
    this.events.push(event);
    this.writtenEvents.push(event);
  }

  requestAction = vi.fn((_action: TActionRequest): Promise<TActionResponse> => {
    return Promise.resolve(this.actionResponse);
  });

  setAvailableCommands(commands: ICommandInfo[]): void {
    this.availableCommands.length = 0;
    this.availableCommands.push(...commands);
  }

  setBusy(busy: boolean): void {
    this.busyState = busy;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  /** Simulate user submitting text. */
  async simulateSubmit(text: string): Promise<void> {
    if (!this.submitHandler) throw new Error('No submit handler registered');
    await this.submitHandler(text);
  }

  /** Set the response that requestAction will return. */
  setActionResponse(response: TActionResponse): void {
    this.actionResponse = response;
  }
}
