/**
 * The conversations on the secret terminal: showing a new phrase once and having it re-typed, and
 * reading an existing phrase back. Every value here stays in local variables of these functions and
 * their caller; nothing is returned to the command but a verdict or, for the caller that derives the
 * master key, the phrase itself.
 */
import {
  RECOVERY_PHRASE_WORDS,
  isRecoveryPhraseWord,
  validateRecoveryPhrase,
} from '@robota-sdk/agent-remote-pairing';

import type { ISecretTerminal } from './secret-terminal.js';

const NL = '\r\n';
const GRID_COLUMNS = 4;
/** How many words the operator re-types to show the phrase was written down. */
const CONFIRM_WORDS = 3;
const CONFIRM_ATTEMPTS = 2;
const PHRASE_ATTEMPTS = 2;

/** A uniform integer in `[0, max)`. */
export type TRandomInt = (max: number) => number;

function normalizeWord(word: string): string {
  return word.normalize('NFKD').trim().toLowerCase();
}

function grid(words: readonly string[]): string {
  const width = Math.max(...words.map((w) => w.length));
  const rows: string[] = [];
  for (let i = 0; i < words.length; i += GRID_COLUMNS) {
    const row = words
      .slice(i, i + GRID_COLUMNS)
      .map((word, j) => `${String(i + j + 1).padStart(2)}. ${word.padEnd(width)}`);
    rows.push(`  ${row.join('   ')}`);
  }
  return rows.join(NL);
}

function distinctPositions(count: number, random: TRandomInt): number[] {
  const chosen = new Set<number>();
  while (chosen.size < count) chosen.add(random(RECOVERY_PHRASE_WORDS));
  return [...chosen].sort((a, b) => a - b);
}

/**
 * Show a new phrase once, clear it, and have a few randomly chosen words re-typed without echo.
 * Resolves `true` only when they match; the phrase is never shown a second time.
 */
export async function presentNewPhrase(
  terminal: ISecretTerminal,
  phrase: string,
  random: TRandomInt,
): Promise<boolean> {
  const words = phrase.split(' ');
  terminal.write(
    [
      'Your recovery phrase. It is shown once, here only, and never stored.',
      'Write the 24 words down, in order, and keep them offline. With the optional passphrase you',
      'set next, they are the only way to recover this identity.',
      '',
      grid(words),
      '',
      '',
    ].join(NL),
  );
  await terminal.readLine('Press Enter once they are written down. ');
  terminal.clearScreen();

  const positions = distinctPositions(CONFIRM_WORDS, random);
  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt += 1) {
    terminal.write(`To confirm, type the requested words (nothing is shown as you type).${NL}`);
    let matched = true;
    for (const position of positions) {
      const typed = await terminal.readLine(`Confirm word #${position + 1}: `);
      if (normalizeWord(typed) !== words[position]) matched = false;
    }
    if (matched) return true;
    terminal.write(`Those words do not match what was shown.${NL}`);
  }
  return false;
}

/** A new optional passphrase, typed twice. `undefined` when the two do not match. */
export async function readNewPassphrase(terminal: ISecretTerminal): Promise<string | undefined> {
  terminal.write(
    `${NL}An optional passphrase is added to the phrase; without it the phrase alone recovers nothing.${NL}` +
      `Forget it and the identity cannot be recovered.${NL}`,
  );
  const passphrase = await terminal.readLine('Optional passphrase (Enter for none): ');
  if (passphrase.length === 0) return '';
  const repeated = await terminal.readLine('Repeat the passphrase: ');
  return repeated === passphrase ? passphrase : undefined;
}

/** The passphrase of an existing phrase (empty when none was set). */
export function readPassphrase(terminal: ISecretTerminal): Promise<string> {
  return terminal.readLine('Passphrase (Enter if none): ');
}

async function readWords(terminal: ISecretTerminal): Promise<string[]> {
  const words: string[] = [];
  while (words.length < RECOVERY_PHRASE_WORDS) {
    const line = await terminal.readLine(`Word ${words.length + 1} of ${RECOVERY_PHRASE_WORDS}: `);
    // Several words on one line (a paste) fill the next positions; one that is not a phrase word
    // stops the line there, and that position is asked again. The typed word is never repeated.
    for (const token of line.split(/\s+/).filter((t) => t.length > 0)) {
      if (words.length === RECOVERY_PHRASE_WORDS) break;
      if (!isRecoveryPhraseWord(token)) {
        terminal.write(`That is not a recovery-phrase word.${NL}`);
        break;
      }
      words.push(normalizeWord(token));
    }
  }
  return words;
}

/**
 * Read an existing phrase word by word with no echo. `undefined` when the words never form a valid
 * phrase; the reason is not detailed beyond that.
 */
export async function readExistingPhrase(terminal: ISecretTerminal): Promise<string | undefined> {
  terminal.write(`Type your recovery phrase, one word at a time (nothing is shown as you type).${NL}`);
  for (let attempt = 1; attempt <= PHRASE_ATTEMPTS; attempt += 1) {
    const phrase = (await readWords(terminal)).join(' ');
    if (validateRecoveryPhrase(phrase).ok) return phrase;
    terminal.write(`Those words do not form a valid recovery phrase.${NL}`);
  }
  return undefined;
}
