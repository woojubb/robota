import type { ISessionRunOptions } from './session-types.js';
import type { IRunOptions } from '@robota-sdk/agent-core';

/** The subset actually present, ready to spread into the agent-core run options. */
export function perTurnRunOptions(
  options?: ISessionRunOptions,
): Pick<
  IRunOptions,
  'ephemeralSystemContext' | 'driverId' | 'toolChoice' | 'traceContext' | 'withholdHostedTools'
> {
  return {
    ...(options?.ephemeralSystemContext !== undefined && {
      ephemeralSystemContext: options.ephemeralSystemContext,
    }),
    ...(options?.driverId !== undefined && { driverId: options.driverId }),
    ...(options?.toolChoice !== undefined && { toolChoice: options.toolChoice }),
    ...(options?.traceContext !== undefined && { traceContext: options.traceContext }),
    // A peer turn's tools are the permission policy's to decide, and a provider's hosted tools never
    // reach the policy — so a peer turn has none.
    ...(options?.peerReach !== undefined && { withholdHostedTools: true }),
  };
}
