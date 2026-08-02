/**
 * Configurable transport contracts — enable/disable + options schema.
 */

import type { ITransportAdapter } from './transport-adapter.js';
import type { IDestroyResult } from '@robota-sdk/agent-core';

export interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface IConfigurableTransport<TSession = unknown> extends ITransportAdapter<TSession> {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
}

export interface ITransportEntry<TSession = unknown> {
  transport: IConfigurableTransport<TSession>;
  config: ITransportConfig;
}

export interface ITransportRegistryView<TSession = unknown> {
  getAll(): ITransportEntry<TSession>[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  startAll(session: TSession): Promise<void>;
  /**
   * Settle when every run-to-completion transport has finished, rejecting with the first failure to
   * occur. Resolves immediately when there are none, which is the ordinary case.
   *
   * ARCH-011: on the VIEW, not only the concrete registry. A run-to-completion transport is started
   * without being awaited, so this is the only place its failure can arrive — and the first draft put
   * it on the class alone, where the two production callers, which both hold this view, could not
   * reach it. A failure route nothing can call is not a route.
   */
  waitForCompletion(): Promise<void>;
  /** Best-effort: never rejects; per-transport stop failures come back in the result (CORE-013). */
  stopAll(): Promise<IDestroyResult>;
}
