import { openOwnerLink, openSpawnerLink } from '@robota-sdk/agent-transport-link';

import { openRegisteredControlStream } from './supervised-session-control.js';

import type { Duplex } from 'node:stream';
import type { IOwnerHandover, SpawnerKey } from '@robota-sdk/agent-keyring';
import type { IOwnerRuntimeLinkClient, IRuntimeLinkClient } from '@robota-sdk/agent-transport-link';

interface IRegistration {
  readonly root: string;
  readonly id: string;
  readonly generation: string;
  /** Cancels opening the connection, not a successfully handed-over link. */
  readonly signal?: AbortSignal;
}

async function openBoundLink<T extends IRuntimeLinkClient>(
  registration: IRegistration,
  open: (stream: Duplex) => Promise<T>,
): Promise<T> {
  const { root, id, generation, signal } = registration;
  const stream = await openRegisteredControlStream(root, id, generation, signal);
  const abort = (): void => { stream.destroy(new Error('The owner link was cancelled.')); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    const link = await open(stream);
    if (signal?.aborted) {
      link.close();
      throw new Error('The owner link was cancelled.');
    }
    if (link.binding.runtimeId !== id || link.binding.generation !== generation) {
      link.close();
      throw new Error('The owner link binding differs from the selected runtime registration.');
    }
    return link;
  } catch (error) {
    stream.destroy();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** Prove the selected runtime's certificate and binding before sending an owner proof. */
export async function openRegisteredOwnerLink(options: IRegistration & { readonly handover: IOwnerHandover }): Promise<IOwnerRuntimeLinkClient> {
  return openBoundLink(options, (stream) => openOwnerLink(stream, options.handover, { expectedBinding: { runtimeId: options.id, generation: options.generation } }));
}

/** Prove the exchanged instance key and selected binding before sending a spawner proof. */
export async function openRegisteredSpawnerLink(options: IRegistration & { readonly spawnerKey: SpawnerKey; readonly instancePublicKey: Uint8Array }): Promise<IRuntimeLinkClient> {
  return openBoundLink(options, (stream) => openSpawnerLink(stream, options.spawnerKey, options.instancePublicKey, { expectedBinding: { runtimeId: options.id, generation: options.generation } }));
}
