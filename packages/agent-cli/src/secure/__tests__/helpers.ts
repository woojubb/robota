/**
 * Fixtures for the keyring tests: a keyring made once per test file, an in-memory store, and a
 * scripted person at the secret terminal who types what a test tells them to and nothing else.
 */
import { createKeyring, serializeKeyring, type IKeyring } from '@robota-sdk/agent-keyring';

import { SecretInputCancelled } from '../../devices/secret-terminal.js';
import { KeyringStoreError } from '../keyring-store.js';

import type { ISecretTerminal, ISecretTerminalSession } from '../../devices/secret-terminal.js';
import type { IKeyringFileState, IKeyringStore, TKeyringLoadResult } from '../keyring-store.js';

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

type TAnswers = string | readonly string[];

/** What the scripted person types at each kind of prompt; the last answer in a list repeats. */
export interface IScriptedPerson {
  readonly passphrase?: TAnswers;
  readonly recoveryKey?: TAnswers;
  readonly newPassphrase?: TAnswers;
  /** Defaults to the new passphrase most recently typed. */
  readonly repeat?: TAnswers;
  /** Defaults to the recovery key as shown on the screen. */
  readonly confirmRecoveryKey?: TAnswers;
  /** Cancel (ctrl-C) at the first prompt that matches. */
  readonly cancelAt?: RegExp;
  /** Runs at every prompt matching `when`, before it is answered. */
  readonly meanwhile?: { readonly when: RegExp; readonly run: () => void | Promise<void> };
}

export interface IScriptedSecureTerminal {
  readonly session: ISecretTerminalSession;
  /** Everything written to the terminal and every prompt, including what was later cleared; never what was typed. */
  readonly everything: () => string;
  /** What is on the screen now (cleared by `clearScreen`, emptied when the session ends). */
  readonly screen: () => string;
  readonly runs: () => number;
  readonly prompts: () => readonly string[];
  /** The recovery key as the person saw it on the screen, once it was shown. */
  readonly shownRecoveryKey: () => string | undefined;
}

const RECOVERY_KEY_PATTERN = /[0-9A-Z]{4}(?:-[0-9A-Z]{4}){7}/;

export function scriptedSecureTerminal(person: IScriptedPerson = {}): IScriptedSecureTerminal {
  let everything = '';
  let screen = '';
  let runs = 0;
  let shown: string | undefined;
  let lastNew = '';
  const prompts: string[] = [];
  const cursors = new Map<string, number>();
  const next = (name: string, answers: TAnswers | undefined): string => {
    if (answers === undefined)
      throw new Error(`the scripted person has nothing to type for ${name}`);
    const list = typeof answers === 'string' ? [answers] : answers;
    const index = cursors.get(name) ?? 0;
    cursors.set(name, index + 1);
    return list[Math.min(index, list.length - 1)] as string;
  };
  const terminal: ISecretTerminal = {
    write: (text) => {
      everything += text;
      screen += text;
      shown ??= RECOVERY_KEY_PATTERN.exec(text)?.[0];
    },
    clearScreen: () => {
      screen = '';
    },
    readLine: async (prompt) => {
      everything += prompt;
      screen += prompt;
      prompts.push(prompt);
      if (person.cancelAt?.test(prompt) === true) throw new SecretInputCancelled();
      if (person.meanwhile?.when.test(prompt) === true) await person.meanwhile.run();
      if (/^New passphrase/.test(prompt)) {
        lastNew = next('new', person.newPassphrase);
        return lastNew;
      }
      if (/^Repeat the passphrase/.test(prompt)) {
        return person.repeat === undefined ? lastNew : next('repeat', person.repeat);
      }
      if (/^Press Enter/.test(prompt)) return '';
      if (/^To confirm, type the recovery key/.test(prompt)) {
        return person.confirmRecoveryKey === undefined
          ? (RECOVERY_KEY_PATTERN.exec(everything)?.[0] ?? '')
          : next('confirm', person.confirmRecoveryKey);
      }
      if (/^Passphrase:/.test(prompt)) return next('passphrase', person.passphrase);
      if (/^Recovery key/.test(prompt)) return next('recovery', person.recoveryKey);
      throw new Error(`unexpected prompt: ${prompt}`);
    },
  };
  return {
    everything: () => everything,
    screen: () => screen,
    runs: () => runs,
    prompts: () => prompts,
    shownRecoveryKey: () => shown,
    session: {
      run: async (work) => {
        runs += 1;
        try {
          return await work(terminal);
        } finally {
          screen = '';
        }
      },
    },
  };
}
