import {
  openOwnerHandover,
  serializeKeyring,
  type IOwnerHandover,
  type TKeyringCredential,
} from '@robota-sdk/agent-keyring';

import { SecretInputCancelled } from '../devices/secret-terminal.js';
import { KeyringStoreError } from './keyring-store.js';
import { retryableRefusal, UNLOCK_ATTEMPTS, type TCredentialKind } from './secure-conversations.js';
import { fingerprintOf } from './sealing-key-warning.js';

import type { ISecretTerminalSession } from '../devices/secret-terminal.js';
import type { IKeyringStore } from './keyring-store.js';

export interface IOwnerAtTerminalOptions {
  readonly store: IKeyringStore;
  readonly purpose: string;
  readonly terminal: ISecretTerminalSession | undefined;
  readonly credential?: TCredentialKind;
}

/** Open a short-lived owner handover only for a person at a secret terminal. */
export async function openOwnerAtTerminal({ store, purpose, terminal, credential = 'passphrase' }: IOwnerAtTerminalOptions): Promise<IOwnerHandover | undefined> {
  if (terminal === undefined) return undefined;
  const loaded = store.load();
  if (loaded.status === 'missing') throw new KeyringStoreError('missing', store.path);
  const snapshot = serializeKeyring(loaded.keyring);
  let opened: IOwnerHandover | undefined;
  try {
    return await terminal.run(async (screen) => {
      screen.write(`Unlock to ${purpose}. Nothing you type is shown.\r\n`);
      for (let attempt = 0; attempt < UNLOCK_ATTEMPTS; attempt += 1) {
        const typed = await screen.readLine(credential === 'passphrase' ? 'Passphrase: ' : 'Recovery key (nothing is shown as you type): ');
        if (typed.length === 0) return undefined;
        const input: TKeyringCredential = credential === 'passphrase'
          ? { type: 'passphrase', passphrase: typed }
          : { type: 'recoveryKey', recoveryKey: typed };
        let owner: IOwnerHandover;
        try {
          owner = await openOwnerHandover(loaded.keyring, input);
        } catch (error) {
          const refusal = retryableRefusal(error);
          if (refusal === undefined) throw error;
          screen.write(`${refusal}\r\n`);
          continue;
        }
        try {
          const current = store.load();
          if (current.status !== 'present' || serializeKeyring(current.keyring) !== snapshot) {
            throw new Error('The keyring changed while it was being unlocked; try again.');
          }
          screen.write(`Sealing public key fingerprint: ${owner.fingerprint}\r\n`);
          if (!owner.sealingKeyMatches) {
            screen.write(`Warning: the stored sealing key differs from the key you unlocked.\r\nStored fingerprint: ${fingerprintOf(loaded.keyring)}\r\nRun secure verify to investigate.\r\n`);
          }
          await screen.readLine('Press Enter to continue, or Ctrl-C to cancel. ');
          opened = owner;
          return owner;
        } catch (error) {
          owner.dispose();
          throw error;
        }
      }
      return undefined;
    });
  } catch (error) {
    opened?.dispose();
    if (error instanceof SecretInputCancelled) return undefined;
    throw error;
  }
}
