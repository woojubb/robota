/**
 * A scripted operator at the secret terminal: it reads the phrase off the screen when it is shown,
 * and answers each prompt the way a person would (or deliberately wrong, when a test asks).
 */
import { SecretInputCancelled } from '../secret-terminal.js';

import type { ISecretTerminal, ISecretTerminalSession } from '../secret-terminal.js';

export interface IScriptedOperator {
  /** Everything ever written to the terminal, including what was later cleared. */
  readonly everything: () => string;
  /** The words of the phrase as shown on screen (after `/devices init`). */
  readonly shownWords: () => readonly string[];
  readonly session: ISecretTerminalSession;
  readonly runs: () => number;
  /** The enrollment code shown on this terminal by `/devices add`, once shown. */
  readonly shownCode: () => string | undefined;
  /** The short string shown on this terminal during an enrollment, once shown. */
  readonly shownSas: () => string | undefined;
}

export interface IScriptedOperatorOptions {
  /** The words to type when asked for an existing phrase. Defaults to the words shown. */
  readonly phrase?: () => readonly string[];
  readonly passphrase?: string;
  /** Type this instead of the requested word when confirming a new phrase. */
  readonly wrongConfirmation?: string;
  /** Type a different passphrase when asked to repeat it. */
  readonly passphraseTypo?: boolean;
  /** What to type at a revoke confirmation; defaults to the id shown in the prompt. */
  readonly revokeAnswer?: (expected: string) => string;
  /** Throw this from the first read (e.g. a cancellation). */
  readonly failWith?: Error;
  /** Runs once, at the first prompt: something else happening while the operator is at the terminal. */
  readonly meanwhile?: () => Promise<void>;
  /** What to type when `/devices join` asks for the code. */
  readonly code?: () => string;
  /** Called with the code once `/devices add` shows it and waits for the new device. */
  readonly onCodeShown?: (code: string) => void;
  /** What to answer when asked to enrol a device; defaults to `yes`. */
  readonly enrolAnswer?: string;
  /** Press ctrl-C while waiting for the other device. */
  readonly cancelWaiting?: boolean;
}

const ENROLLMENT_CODE = /[0-9A-Z]{5}(?:-[0-9A-Z]{5}){4}/;
const SAS = /should show[^\d]*(\d{3} \d{3})/;

const GRID_ENTRY = /(\d+)\. ([a-z]+)/g;

export function scriptedOperator(options: IScriptedOperatorOptions = {}): IScriptedOperator {
  let everything = '';
  let screen = '';
  let words: string[] = [];
  let runs = 0;
  let meanwhileRan = false;
  let code: string | undefined;
  let sas: string | undefined;
  const waitWithdrawn = (signal: AbortSignal | undefined): Promise<string> =>
    new Promise<string>((_, reject) => {
      if (options.cancelWaiting === true || signal === undefined) {
        reject(new SecretInputCancelled());
        return;
      }
      if (signal.aborted) reject(new SecretInputCancelled());
      signal.addEventListener('abort', () => reject(new SecretInputCancelled()), { once: true });
    });
  const terminal: ISecretTerminal = {
    write: (text) => {
      everything += text;
      screen += text;
      sas = SAS.exec(text)?.[1] ?? sas;
    },
    clearScreen: () => {
      screen = '';
    },
    readLine: async (prompt, readOptions) => {
      everything += prompt;
      screen += prompt;
      if (options.failWith) throw options.failWith;
      if (/Waiting for the new device/.test(prompt)) {
        const shown = ENROLLMENT_CODE.exec(screen)?.[0];
        if (shown !== undefined && code === undefined) {
          code = shown;
          options.onCodeShown?.(shown);
        }
        return waitWithdrawn(readOptions?.signal);
      }
      if (/Connecting/.test(prompt)) return waitWithdrawn(readOptions?.signal);
      if (/Type yes to enrol/.test(prompt)) return options.enrolAnswer ?? 'yes';
      if (/Type the code/.test(prompt)) return options.code?.() ?? '';
      if (options.meanwhile !== undefined && !meanwhileRan) {
        meanwhileRan = true;
        await options.meanwhile();
      }
      if (/Press Enter/.test(prompt)) {
        words = [];
        for (const match of screen.matchAll(GRID_ENTRY)) words[Number(match[1]) - 1] = match[2]!;
        return '';
      }
      const confirm = /Confirm word #(\d+)/.exec(prompt);
      if (confirm) return options.wrongConfirmation ?? words[Number(confirm[1]) - 1]!;
      const existing = /Word (\d+) of 24/.exec(prompt);
      if (existing) {
        const phrase = options.phrase?.() ?? words;
        return phrase[Number(existing[1]) - 1]!;
      }
      if (/Repeat the passphrase/.test(prompt)) {
        return options.passphraseTypo === true
          ? `${options.passphrase ?? ''}x`
          : (options.passphrase ?? '');
      }
      if (/passphrase/i.test(prompt)) return options.passphrase ?? '';
      const revoke = /Type (\S+) to confirm/.exec(prompt);
      if (revoke) return options.revokeAnswer?.(revoke[1]!) ?? revoke[1]!;
      throw new Error(`unexpected prompt: ${prompt}`);
    },
  };
  return {
    everything: () => everything,
    shownWords: () => words,
    runs: () => runs,
    shownCode: () => code,
    shownSas: () => sas,
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
