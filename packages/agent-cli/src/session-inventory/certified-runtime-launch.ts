import { launchAndCertifyRuntime } from '@robota-sdk/agent-local-host';

import { resolveSupervisedDirectory } from './supervised-session-control.js';
import { launchRuntimeProcess, type ISupervisedLaunchOptions } from './supervised-session-launch.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';

/**
 * The caller holds its owner handover and any workspace start lock until this returns. A launch that
 * fails after the runtime was proved returns only once that runtime is gone.
 */
export async function launchCertifiedRuntime(
  cwd: string,
  options: ISupervisedLaunchOptions & { readonly handover: IOwnerHandover; readonly daemonRole?: boolean },
): Promise<{ readonly id: string; readonly generation: string }> {
  return launchAndCertifyRuntime({
    root: options.root ?? resolveSupervisedDirectory(options.productRuntime),
    handover: options.handover,
    ...(options.daemonRole === undefined ? {} : { daemonRole: options.daemonRole }),
    start: () => launchRuntimeProcess(cwd, { ...options, mode: 'spawner' }),
  });
}
