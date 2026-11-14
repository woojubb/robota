/**
 * Test doubles for the keyring this package stores: a keyring made once per test file and an
 * in-memory store that follows the file store's write rules. A host that seals with this package
 * tests against the same doubles instead of keeping its own copy.
 */
import { createKeyring, serializeKeyring, type IKeyring } from '@robota-sdk/agent-keyring';

import { KeyringStoreError } from './keyring-store.js';

import type { IKeyringFileState, IKeyringStore, TKeyringLoadResult } from './keyring-store.js';

export const FIXTURE_PASSPHRASE = 'correct horse battery staple';
export const OTHER_PASSPHRASE = 'a different long passphrase';

export interface IFixtureKeyring {
  readonly keyring: IKeyring;
  readonly recoveryKey: string;
}

let fixture: Promise<IFixtureKeyring> | undefined;

/** One keyring per test file: key derivation costs ~150 ms, and nothing here mutates it. */
export function fixtureKeyring(): Promise<IFixtureKeyring> {
  fixture ??= createKeyring({ passphrase: FIXTURE_PASSPHRASE }).then(
    ({ keyring, recoveryKey, unlocked }) => {
      unlocked.lock();
      return { keyring, recoveryKey };
    },
  );
  return fixture;
}

export interface IMemoryKeyringStore extends IKeyringStore {
  readonly saves: IKeyring[];
  current(): IKeyring | undefined;
  /** Replace what is "on disk" without going through `save`, as an attacker with write access would. */
  tamper(keyring: IKeyring): void;
  failSaves(error: Error): void;
}

/** The file store's write rules in memory: `create` only where there is none, `save` only over `expected`. */
export function createMemoryKeyringStore(initial?: IKeyring): IMemoryKeyringStore {
  const path = '/memory/secure/keyring.json';
  let stored = initial;
  let failure: Error | undefined;
  const saves: IKeyring[] = [];
  const write = (keyring: IKeyring): void => {
    if (failure !== undefined) throw failure;
    stored = keyring;
    saves.push(keyring);
  };
  return {
    path,
    saves,
    current: () => stored,
    tamper: (keyring) => {
      stored = keyring;
    },
    failSaves: (error) => {
      failure = error;
    },
    load: (): TKeyringLoadResult =>
      stored === undefined ? { status: 'missing' } : { status: 'present', keyring: stored },
    create: (keyring) => {
      if (stored !== undefined) throw new KeyringStoreError('exists', path);
      write(keyring);
    },
    save: (keyring, expected) => {
      if (stored === undefined || serializeKeyring(stored) !== serializeKeyring(expected)) {
        throw new KeyringStoreError('changed', path);
      }
      write(keyring);
    },
    inspect: (): IKeyringFileState => ({ exists: stored !== undefined }),
  };
}

/** The keyring with its stored sealing public key swapped for another keyring's, as a file writer could. */
export function withSwappedSealingKey(keyring: IKeyring, other: IKeyring): IKeyring {
  return { ...keyring, sealingPublicKey: other.sealingPublicKey };
}
