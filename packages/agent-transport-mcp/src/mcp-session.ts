import type {
  ISessionCommands,
  ISessionTurnSubmission,
} from '@robota-sdk/agent-interface-transport';

/** The exact session capabilities consumed by the MCP transport. */
export interface IMcpTransportSession extends ISessionTurnSubmission, ISessionCommands {}
