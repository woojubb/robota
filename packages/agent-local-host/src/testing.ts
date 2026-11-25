/**
 * Test doubles for what this package provides: a keyring made once per test file, an in-memory
 * store that follows the file store's write rules, and a workspace-root broker run in a child
 * process. A host that seals with this package or asks its broker tests against the same doubles
 * instead of keeping its own copy.
 */
import { spawn } from 'node:child_process';

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

export interface ITestBrokerProcess {
  close(): Promise<void>;
  readonly exited: Promise<void>;
}

/**
 * Runs a workspace-root broker in another process, so a synchronous project operation, which blocks
 * the event loop of the process that asks, can reach it. `argv` is everything after the Node
 * executable: the program that starts the broker and sends `ready` over its IPC channel. The host
 * names its own launcher, so this package never knows a product entry point.
 */
export async function startTestBrokerProcess(argv: readonly string[]): Promise<ITestBrokerProcess> {
  const child = spawn(process.execPath, [...argv], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Broker startup timed out: ${stderr}`)),
        15_000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.once('message', (message) =>
        finish(message === 'ready' ? undefined : new Error(stderr)),
      );
      child.once('exit', () => finish(new Error(`Broker exited: ${stderr}`)));
      child.once('error', finish);
    });
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    exited,
    close: () =>
      (closing ??= new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('close', () => resolve());
        child.kill('SIGTERM');
      })),
  };
}
