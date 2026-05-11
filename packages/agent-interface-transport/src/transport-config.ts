/**
 * Configurable transport contracts — enable/disable + options schema.
 */

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { ITransportAdapter } from './transport-adapter.js';

export interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, TUniversalValue>;
}

export interface IConfigurableTransport extends ITransportAdapter {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<
    string,
    { type: string; description: string; default?: TUniversalValue }
  >;
  validateOptions?(options: Record<string, TUniversalValue>): boolean;
}

export interface ITransportEntry {
  transport: IConfigurableTransport;
  config: ITransportConfig;
}

export interface ITransportRegistryView {
  getAll(): ITransportEntry[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  startAll(session: import('@robota-sdk/agent-core').ISession): Promise<void>;
  stopAll(): Promise<void>;
}
