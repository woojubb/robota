import { renderApp, type ITuiRenderOptions } from './render.js';

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-framework';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';

export class TuiTransport implements IConfigurableTransport<IInteractiveSession> {
  readonly name = 'tui';
  readonly defaultEnabled = true;
  readonly optionsSchema = {};

  private readonly options: ITuiRenderOptions;

  constructor(options: ITuiRenderOptions) {
    this.options = options;
  }

  attach(_session: IInteractiveSession): void {
    // TuiTransport creates its own InteractiveSession internally via useInteractiveSession.
  }

  async start(): Promise<void> {
    await renderApp(this.options);
  }

  async stop(): Promise<void> {
    // Ink exits when the user triggers shutdown from within the TUI.
  }

  validateOptions(_options: Record<string, TUniversalValue>): boolean {
    return true;
  }
}
