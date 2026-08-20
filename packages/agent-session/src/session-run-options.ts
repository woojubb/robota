import type { ISessionRunOptions } from './session-types.js';

/** The subset actually present, ready to spread into the agent-core run options. */
export function perTurnRunOptions(options?: ISessionRunOptions): ISessionRunOptions {
  return {
    ...(options?.ephemeralSystemContext !== undefined && {
      ephemeralSystemContext: options.ephemeralSystemContext,
    }),
    ...(options?.driverId !== undefined && { driverId: options.driverId }),
  };
}
