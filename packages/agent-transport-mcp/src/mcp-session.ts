import type {
  ISessionEvents,
  ISessionPromptResolution,
  ISessionRuntimeTools,
  ISessionTurnSubmission,
} from '@robota-sdk/agent-interface-session';

/**
 * The exact session capabilities consumed by the MCP transport: turn submission and runtime tools
 * for the calls it serves, and the prompt events and resolution through which a caller's own
 * permission and ask prompts are put to the caller when the operator enabled that.
 */
export interface IMcpTransportSession
  extends ISessionTurnSubmission, ISessionRuntimeTools, ISessionEvents, ISessionPromptResolution {}
