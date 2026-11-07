import { openOwnerLink, openSpawnerLink } from './open-runtime-link.js';

import type { Duplex } from 'node:stream';
import type { ILinkBinding, IOwnerHandover, SpawnerKey } from '@robota-sdk/agent-keyring';
import type { IOwnerRuntimeLinkClient, IRuntimeLinkClient } from './open-runtime-link.js';

interface ISelectedCarrier {
  readonly binding: ILinkBinding;
  /** A trusted carrier must validate the selected registration before connecting. */
  readonly openStream: (signal?: AbortSignal) => Promise<Duplex>;
  /** Cancels opening only, not a link successfully returned to the caller. */
  readonly signal?: AbortSignal;
}

async function openSelected<T extends IRuntimeLinkClient>(
  options: ISelectedCarrier,
  open: (stream: Duplex, binding: ILinkBinding) => Promise<T>,
): Promise<T> {
  const { signal, openStream } = options;
  const binding = { runtimeId: options.binding.runtimeId, generation: options.binding.generation };
  if (signal?.aborted) throw new Error('The owner link was cancelled.');
  let stream: Duplex | undefined;
  let rejectCancellation!: (error: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  void cancelled.catch(() => {});
  const abort = (): void => {
    stream?.destroy();
    rejectCancellation(new Error('The owner link was cancelled.'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    const carrier = Promise.resolve(openStream(signal));
    void carrier.then((late) => { if (signal?.aborted) late.destroy(); }, () => {});
    stream = await Promise.race([carrier, cancelled]);
    if (signal?.aborted) { stream.destroy(); throw new Error('The owner link was cancelled.'); }
    const opening = open(stream, binding);
    void opening.then((late) => { if (signal?.aborted) late.close(); }, () => {});
    const link = await Promise.race([opening, cancelled]);
    if (signal?.aborted) { link.close(); throw new Error('The owner link was cancelled.'); }
    if (link.binding.runtimeId !== binding.runtimeId || link.binding.generation !== binding.generation) {
      link.close();
      throw new Error('The owner link binding differs from the selected runtime registration.');
    }
    return link;
  } catch (error) {
    stream?.destroy();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

/** Authenticate an owner link against a selected runtime start on a trusted carrier. */
export function openSelectedOwnerLink(options: ISelectedCarrier & { readonly handover: IOwnerHandover }): Promise<IOwnerRuntimeLinkClient> {
  return openSelected(options, (stream, binding) => openOwnerLink(stream, options.handover, { expectedBinding: binding }));
}

/** Authenticate a spawner link against a selected runtime start on a trusted carrier. */
export function openSelectedSpawnerLink(options: ISelectedCarrier & { readonly spawnerKey: SpawnerKey; readonly instancePublicKey: Uint8Array }): Promise<IRuntimeLinkClient> {
  return openSelected(options, (stream, binding) => openSpawnerLink(stream, options.spawnerKey, options.instancePublicKey, { expectedBinding: binding }));
}
