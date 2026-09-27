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
  ISessionProjectRead,
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

/**
 * #3282 §4c: a protocol session that ALSO answers the Project panel's reads. `Partial` (not a fourth
 * mandatory role on {@link IProtocolSession} itself) deliberately: every existing test double and
 * every other host that builds an `IProtocolSession` keeps type-checking unchanged, and the panel's
 * three methods are runtime-probed (`typeof session.readProjectStatus === 'function'`) rather than
 * assumed — `InteractiveSession` (the one production implementation) provides all three, satisfying
 * this type with no further wiring.
 */
export type TProjectReadCapableSession = IProtocolSession & Partial<ISessionProjectRead>;
