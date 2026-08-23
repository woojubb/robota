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
    ISessionExecutionState {}
