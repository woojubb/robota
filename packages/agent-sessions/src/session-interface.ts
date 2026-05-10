/**
 * Minimal session abstraction used by transport contracts.
 * Keeps agent-interface-transport free of agent-sdk circular dependencies.
 */

export interface ISession {
  readonly sessionId: string;
}
