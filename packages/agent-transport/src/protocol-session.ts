import type {
  ISessionBackgroundGroups,
  ISessionBackgroundTasks,
  ISessionCommands,
  ISessionConversationRead,
  ISessionDriverAttribution,
  ISessionEvents,
  ISessionExecutionDetail,
  ISessionExecutionState,
  ISessionExecutionWorkspace,
  ISessionPromptResolution,
  ISessionSelfPacedLoopControl,
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
    ISessionExecutionWorkspace,
    ISessionExecutionDetail,
    ISessionSelfPacedLoopControl {}
