/**
 * Core transport adapter contract.
 * Moved from agent-sdk to break the circular dependency between
 * agent-transport-* implementations and the assembly layer.
 */

export interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  attach(session: TSession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
