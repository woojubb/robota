import { openRegisteredOwnerLink, openRegisteredSpawnerLink } from './owner-link-client.js';
import { listSupervisedRuntimes, stopStartedSupervisedSession } from './supervised-control-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { ISpawnerPairResult } from '@robota-sdk/agent-transport/link';

async function withinDeadline<T>(action: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([action, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The runtime did not complete owner admission in time.')), 5_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** What a certified launch needs from its caller: where runtimes register, who the owner is, and how to start one. */
export interface ICertifiedRuntimeLaunch {
  /** The supervised directory the started runtime registers under. */
  readonly root: string;
  readonly handover: IOwnerHandover;
  /** The runtime takes its workspace's daemon role once it is certified. */
  readonly daemonRole?: boolean;
  /**
   * Starts a runtime that waits for its spawner and returns the spawner's key with it. The key is
   * wiped when the launch ends, whatever the outcome.
   */
  start(): Promise<{ readonly id: string } & ISpawnerPairResult>;
}

/**
 * Start a runtime and certify it for its owner: prove it, install the owner's trust root within a
 * deadline, open the owner link and, if asked, hand it the daemon role. The caller holds its owner
 * handover and any workspace start lock until this returns. A launch that fails after the runtime
 * was proved returns only once that runtime is gone.
 */
export async function launchAndCertifyRuntime(
  launch: ICertifiedRuntimeLaunch,
): Promise<{ readonly id: string; readonly generation: string }> {
  const { root, handover } = launch;
  const started = await launch.start();
  let provenGeneration: string | undefined;
  try {
    const runtimes = await listSupervisedRuntimes(root);
    const runtime = runtimes.find((item) => item.id === started.id && item.liveness === 'alive' && item.control === 'available');
    if (runtime?.generation === undefined) throw new Error('The started runtime has no live registration.');
    const registration = { root, id: started.id, generation: runtime.generation };
    const spawner = await openRegisteredSpawnerLink({ ...registration, spawnerKey: started.spawnerKey, instancePublicKey: started.instancePublicKey });
    provenGeneration = runtime.generation;
    try {
      await withinDeadline((async () => {
        await spawner.installTrustRoot(handover.certify(spawner.instancePublicKey, spawner.binding));
        await spawner.closed;
      })());
    } finally {
      spawner.close();
    }
    const owner = await openRegisteredOwnerLink({ ...registration, handover });
    try {
      if (launch.daemonRole === true) {
        const result = await withinDeadline(owner.control({ command: 'take-daemon-role', fields: {} }));
        if (result.status !== 'daemon') throw new Error('The runtime did not accept its daemon role.');
      }
    } finally {
      owner.close();
    }
    return { id: started.id, generation: runtime.generation };
  } catch (error) {
    if (provenGeneration !== undefined) {
      try { await stopStartedSupervisedSession(started.id, root, provenGeneration); } catch { /* It may already be gone, or refuse to leave; the launch's own failure is what the caller needs. */ }
    }
    throw error;
  } finally {
    started.spawnerKey.wipe();
  }
}
