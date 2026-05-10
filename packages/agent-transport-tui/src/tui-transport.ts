import type { ISession } from '@robota-sdk/agent-sessions';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import { renderApp, type IRenderOptions } from './render.js';

export class TuiTransport implements IConfigurableTransport {
  readonly name = 'tui';
  readonly defaultEnabled = true;
  readonly optionsSchema = {};

  private readonly options: IRenderOptions;

  constructor(options: IRenderOptions) {
    this.options = options;
  }

  attach(_session: ISession): void {
    // TuiTransport creates its own InteractiveSession internally via useInteractiveSession.
    // The attach() hook is a no-op for now.
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
