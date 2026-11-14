/**
 * Fixtures for the keyring tests: the keyring doubles come from the package that owns the keyring
 * store, and a scripted person at the secret terminal types what a test tells them to and nothing else.
 */
import { SecretInputCancelled } from '../../devices/secret-terminal.js';

import type { ISecretTerminal, ISecretTerminalSession } from '../../devices/secret-terminal.js';

export {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
  withSwappedSealingKey,
} from '@robota-sdk/agent-local-host/testing';
export type { IFixtureKeyring, IMemoryKeyringStore } from '@robota-sdk/agent-local-host/testing';

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
