import { openRegisteredOwnerLink } from './owner-link-client.js';
import { MAX_EARLY_FRAMES, type ISupervisedAttachConnection } from './supervised-attach-client.js';

import type { IOwnerHandover } from '@robota-sdk/agent-keyring';
import type { TServerMessage } from '@robota-sdk/agent-transport';

const MAX_EARLY_BYTES = 1024 * 1024;

/** The caller owns and disposes the handover after the attached view ends. */
export async function openSecureAttach(options: {
  readonly root: string;
  readonly id: string;
  readonly generation: string;
  readonly mode: 'drive' | 'observe';
  readonly handover: IOwnerHandover;
  readonly onMismatch?: () => void;
}): Promise<ISupervisedAttachConnection> {
  const link = await openRegisteredOwnerLink(options);
  const listeners = new Set<(message: TServerMessage) => void>();
  const early: TServerMessage[] = [];
  let earlyBytes = 0;
  const unsubscribe = link.session.onMessage((message) => {
    if (listeners.size > 0) {
      for (const listener of [...listeners]) listener(message);
    } else {
      earlyBytes += Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (early.length < MAX_EARLY_FRAMES && earlyBytes <= MAX_EARLY_BYTES) early.push(message);
      else link.close();
    }
  });
  let closed = false;
  const closedListeners = new Set<() => void>();
  void link.closed.then(() => {
    closed = true;
    unsubscribe();
    for (const listener of [...closedListeners]) listener();
    closedListeners.clear();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attached = await Promise.race([(async () => {
      const outcome = await link.unlock();
      if (outcome === 'mismatch') {
        if (options.onMismatch === undefined) throw new Error('The runtime sealing key differs from the unlocked key.');
        options.onMismatch();
      }
      return link.control({ command: 'attach', fields: { mode: options.mode } });
    })(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Secure attach timed out.')), 10_000);
    })]);
    if (attached.status !== 'attached' || typeof attached.driverId !== 'string' || attached.driverId.length === 0) {
      throw new Error('The secure runtime refused attach.');
    }
    return {
      driverId: attached.driverId,
      send: (message) => link.session.send(message),
      subscribe: (listener) => {
        listeners.add(listener);
        if (listeners.size === 1) {
          earlyBytes = 0;
          for (const message of early.splice(0)) listener(message);
        }
        return () => { listeners.delete(listener); };
      },
      onClose: (listener) => {
        if (closed) { queueMicrotask(listener); return () => {}; }
        closedListeners.add(listener);
        return () => { closedListeners.delete(listener); };
      },
      detach: () => link.close(),
    };
  } catch (error) {
    link.close();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
