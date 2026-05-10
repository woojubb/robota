/**
 * Core transport adapter contract.
 * Moved from agent-sdk to break the circular dependency between
 * agent-transport-* implementations and the assembly layer.
 */

import type { ISession } from '@robota-sdk/agent-sessions';

export interface ITransportAdapter {
  readonly name: string;
  attach(session: ISession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
