import { openRegisteredOwnerLink, openRegisteredSpawnerLink } from './owner-link-client.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopStartedSupervisedSession } from './supervised-session-control.js';
import { launchRuntimeProcess, type ISupervisedLaunchOptions } from './supervised-session-launch.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';

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

/**
 * The caller holds its owner handover and any workspace start lock until this returns. A launch that
 * fails after the runtime was proved returns only once that runtime is gone.
 */
export async function launchCertifiedRuntime(
  cwd: string,
  options: ISupervisedLaunchOptions & { readonly handover: IOwnerHandover; readonly daemonRole?: boolean },
): Promise<{ readonly id: string; readonly generation: string }> {
  const root = options.root ?? resolveSupervisedDirectory(options.productRuntime);
  const started = await launchRuntimeProcess(cwd, { ...options, mode: 'spawner' });
  let provenGeneration: string | undefined;
  try {
    const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true });
    const row = rows.find((item) => item.id === started.id && item.liveness === 'alive' && item.control === 'available');
    if (row?.generation === undefined) throw new Error('The started runtime has no live registration.');
    const registration = { root, id: started.id, generation: row.generation };
    const spawner = await openRegisteredSpawnerLink({ ...registration, spawnerKey: started.spawnerKey, instancePublicKey: started.instancePublicKey });
    provenGeneration = row.generation;
    try {
      await withinDeadline((async () => {
        await spawner.installTrustRoot(options.handover.certify(spawner.instancePublicKey, spawner.binding));
        await spawner.closed;
      })());
    } finally {
      spawner.close();
    }
    const owner = await openRegisteredOwnerLink({ ...registration, handover: options.handover });
    try {
      if (options.daemonRole === true) {
        const result = await withinDeadline(owner.control({ command: 'take-daemon-role', fields: {} }));
        if (result.status !== 'daemon') throw new Error('The runtime did not accept its daemon role.');
      }
    } finally {
      owner.close();
    }
    return { id: started.id, generation: row.generation };
  } catch (error) {
    if (provenGeneration !== undefined) {
      try { await stopStartedSupervisedSession(started.id, root, provenGeneration); } catch { /* It may already be gone, or refuse to leave; the launch's own failure is what the caller needs. */ }
    }
    throw error;
  } finally {
    started.spawnerKey.wipe();
  }
}
