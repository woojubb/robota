/** Where a recovery phrase must never be found, and how to look for it. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under `root`, recursively, with its contents. */
export function filesUnder(root: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) out.push({ path, text: readFileSync(path, 'latin1') });
    }
  };
  walk(root);
  return out;
}

/**
 * The fragments that would give the phrase away: the phrase itself (spaced, joined, any case), every
 * adjacent pair of its words, and each word as numbered on the screen it is shown on — so a partial,
 * reformatted or screen-copied phrase is caught as well as a whole one.
 */
export function phraseFragments(words: readonly string[], passphrase?: string): string[] {
  const fragments = [words.join(' '), words.join(''), words.join(',')];
  for (let i = 0; i + 1 < words.length; i += 1) fragments.push(`${words[i]} ${words[i + 1]}`);
  words.forEach((word, i) => fragments.push(`${i + 1}. ${word}`));
  if (passphrase !== undefined && passphrase.length > 0) fragments.push(passphrase);
  return fragments;
}

/** The fragments found in `text` (case-insensitive). Empty means nothing leaked. */
export function leakedIn(text: string, fragments: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return fragments.filter((fragment) => lower.includes(fragment.toLowerCase()));
}
