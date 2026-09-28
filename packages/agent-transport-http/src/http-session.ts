import type {
  ISessionCommands,
  ISessionConversationRead,
  ISessionEvents,
  ISessionExecutionState,
  ISessionIdentity,
  ISessionTurnControl,
  ISessionTurnSubmission,
} from '@robota-sdk/agent-interface-session';

/** The exact session capabilities consumed by the public HTTP transport. */
export interface IHttpTransportSession
  extends
    ISessionTurnSubmission,
    ISessionEvents,
    ISessionTurnControl,
    ISessionIdentity,
    ISessionCommands,
    ISessionConversationRead,
    ISessionExecutionState {
  /**
   * Resolves once the session can name itself, and rejects if it failed to start. A session that
   * builds itself in the background (`InteractiveSession`) has no id before then, so `/submit` waits
   * on this before claiming a turn. A session that is ready at construction can omit it.
   */
  whenInitialized?(): Promise<void>;
}
