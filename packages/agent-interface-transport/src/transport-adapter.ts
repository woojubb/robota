/**
 * Core transport adapter contract.
 * Moved from agent-sdk to break the circular dependency between
 * agent-transport-* implementations and the assembly layer.
 */

import type { ISession } from '@robota-sdk/agent-core';

export interface ITransportAdapter<TSession = ISession> {
  readonly name: string;
  attach(session: TSession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
