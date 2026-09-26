/**
 * A scripted operator at the secret terminal: it reads the phrase off the screen when it is shown,
 * and answers each prompt the way a person would (or deliberately wrong, when a test asks).
 */
import type { ISecretTerminal, ISecretTerminalSession } from '../secret-terminal.js';

export interface IScriptedOperator {
  /** Everything ever written to the terminal, including what was later cleared. */
  readonly everything: () => string;
  /** The words of the phrase as shown on screen (after `/devices init`). */
  readonly shownWords: () => readonly string[];
  readonly session: ISecretTerminalSession;
  readonly runs: () => number;
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
}

const GRID_ENTRY = /(\d+)\. ([a-z]+)/g;

export function scriptedOperator(options: IScriptedOperatorOptions = {}): IScriptedOperator {
  let everything = '';
  let screen = '';
  let words: string[] = [];
  let runs = 0;
  let meanwhileRan = false;
  const terminal: ISecretTerminal = {
    write: (text) => {
      everything += text;
      screen += text;
    },
    clearScreen: () => {
      screen = '';
    },
    readLine: async (prompt) => {
      everything += prompt;
      screen += prompt;
      if (options.failWith) throw options.failWith;
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
        return options.passphraseTypo === true ? `${options.passphrase ?? ''}x` : options.passphrase ?? '';
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
