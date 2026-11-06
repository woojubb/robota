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

/** Prove the exchanged instance key and selected binding before sending a spawner proof. */
export async function openRegisteredSpawnerLink(options: IRegistration & { readonly spawnerKey: SpawnerKey; readonly instancePublicKey: Uint8Array }): Promise<IRuntimeLinkClient> {
  const { root, id, generation, signal, spawnerKey, instancePublicKey } = options;
  return openSelectedSpawnerLink({ binding: { runtimeId: id, generation }, spawnerKey, instancePublicKey,
    openStream: (openingSignal) => openRegisteredControlStream(root, id, generation, openingSignal),
    ...(signal ? { signal } : {}) });
}
