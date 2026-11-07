import { openSelectedOwnerLink, openSelectedSpawnerLink } from '@robota-sdk/agent-transport-link';

import { openRegisteredControlStream } from '@robota-sdk/agent-local-host';

import type { IOwnerHandover, SpawnerKey } from '@robota-sdk/agent-keyring';
import type { IOwnerRuntimeLinkClient, IRuntimeLinkClient } from '@robota-sdk/agent-transport-link';

interface IRegistration {
  readonly root: string;
  readonly id: string;
  readonly generation: string;
  /** Cancels opening the connection, not a successfully handed-over link. */
  readonly signal?: AbortSignal;
}

/** Prove the selected runtime's certificate and binding before sending an owner proof. */
export async function openRegisteredOwnerLink(options: IRegistration & { readonly handover: IOwnerHandover }): Promise<IOwnerRuntimeLinkClient> {
  const { root, id, generation, signal, handover } = options;
  return openSelectedOwnerLink({ binding: { runtimeId: id, generation }, handover,
    openStream: (openingSignal) => openRegisteredControlStream(root, id, generation, openingSignal),
    ...(signal ? { signal } : {}) });
}

/** A new owner either joins a live client set or retires every grant from a previous owner epoch. */
export async function openPreparedOwnerLink(options: IRegistration & { readonly handover: IOwnerHandover }): Promise<{
  readonly link: IOwnerRuntimeLinkClient;
  readonly grantNeeded: boolean;
}> {
  const first = await openRegisteredOwnerLink(options);
  const within = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Secure owner barrier timed out.')), 5_000);
      })]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  try {
    const membership = await within(first.control({ command: 'custody-membership', fields: {} }));
    if (membership.status !== 'membership' || typeof membership.unlocked !== 'boolean' ||
        !Number.isSafeInteger(membership.attachedOwners) || Number(membership.attachedOwners) < 0 ||
        !Number.isSafeInteger(membership.epoch)) {
      throw new Error('The secure runtime did not prove its active client set.');
    }
    if (membership.unlocked && Number(membership.attachedOwners) > 0) {
      return { link: first, grantNeeded: false };
    }
    await within(first.lock('fault'));
    first.revokeToCleanup();
    first.close();
    await within(first.closed);
  } catch (error) {
    first.revokeToCleanup();
    first.close();
    throw error;
  }
  if (options.signal?.aborted) throw new Error('The owner opening was cancelled.');
  const link = await openRegisteredOwnerLink(options);
  return { link, grantNeeded: true };
}

/** Prove the exchanged instance key and selected binding before sending a spawner proof. */
export async function openRegisteredSpawnerLink(options: IRegistration & { readonly spawnerKey: SpawnerKey; readonly instancePublicKey: Uint8Array }): Promise<IRuntimeLinkClient> {
  const { root, id, generation, signal, spawnerKey, instancePublicKey } = options;
  return openSelectedSpawnerLink({ binding: { runtimeId: id, generation }, spawnerKey, instancePublicKey,
    openStream: (openingSignal) => openRegisteredControlStream(root, id, generation, openingSignal),
    ...(signal ? { signal } : {}) });
}
