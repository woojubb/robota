import type {
  ISessionCommands,
  ISessionEvents,
  ISessionGoal,
  ISessionIdentity,
  ISessionTurnSubmission,
} from '@robota-sdk/agent-interface-session';

/** Session roles required by the headless runner and transport. */
export interface IHeadlessSession
  extends
    ISessionTurnSubmission,
    ISessionEvents,
    ISessionCommands,
    ISessionGoal,
    ISessionIdentity {}
