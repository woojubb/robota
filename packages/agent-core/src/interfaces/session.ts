/**
 * Minimal session abstraction shared across contract layers.
 * Lives in agent-core (Domain) so interface-level packages can reference it
 * without depending on agent-sessions (Session services layer).
 */
export interface ISession {
  readonly sessionId: string;
}
