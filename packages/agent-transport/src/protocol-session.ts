import type {
  ISessionBackgroundGroups,
  ISessionBackgroundTasks,
  ISessionCommands,
  ISessionConversationRead,
  ISessionDriverAttribution,
  ISessionEvents,
  ISessionExecutionState,
  ISessionExecutionWorkspace,
  ISessionPromptResolution,
  ISessionStatusRead,
  ISessionTurnControl,
  ISessionTurnSubmission,
} from '@robota-sdk/agent-interface-session';

/** Session roles required by the shared WebSocket/WebRTC protocol. */
export interface IProtocolSession
  extends
    ISessionTurnSubmission,
    ISessionTurnControl,
    ISessionCommands,
    ISessionStatusRead,
    ISessionEvents,
    ISessionPromptResolution,
    ISessionConversationRead,
    ISessionExecutionState,
    ISessionDriverAttribution,
    ISessionBackgroundTasks,
    ISessionBackgroundGroups,
    ISessionExecutionWorkspace {}
