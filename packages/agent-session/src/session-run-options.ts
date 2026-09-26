import type { ISessionRunOptions } from './session-types.js';
import type { IRunOptions } from '@robota-sdk/agent-core';

/** The subset actually present, ready to spread into the agent-core run options. */
export function perTurnRunOptions(
  options?: ISessionRunOptions,
): Pick<
  IRunOptions,
  | 'ephemeralSystemContext'
  | 'driverId'
  | 'turnSource'
  | 'toolChoice'
  | 'traceContext'
  | 'withholdHostedTools'
> {
  return {
    ...(options?.ephemeralSystemContext !== undefined && {
      ephemeralSystemContext: options.ephemeralSystemContext,
    }),
    ...(options?.driverId !== undefined && { driverId: options.driverId }),
    ...(options?.turnSource !== undefined && { turnSource: options.turnSource }),
    ...(options?.toolChoice !== undefined && { toolChoice: options.toolChoice }),
    ...(options?.traceContext !== undefined && { traceContext: options.traceContext }),
    // What a message-triggered turn does is decided by the ordinary permissions, and a provider's
    // hosted tools run at the vendor without reaching them — so such a turn has none.
    ...(options?.peerTurn === true && { withholdHostedTools: true }),
  };
}
