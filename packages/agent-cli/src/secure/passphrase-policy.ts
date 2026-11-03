/**
 * The passphrase rule for the keyring. The keyring file is readable by every program running as the
 * user, so a passphrase is guessed offline at scrypt speed. Length is the one thing a person can add
 * that the cost parameters cannot, and input that is one short pattern repeated is among the first
 * things a guesser tries, so both are refused. Together they raise the cost of offline guessing; they
 * do not make a weak passphrase safe, and strength beyond them is the person's.
 */

export const MIN_PASSPHRASE_CHARACTERS = 12;
/** Fewer distinct characters than this is a pattern, not a passphrase, however long. */
const MIN_DISTINCT_CHARACTERS = 5;

/** What the person is told before choosing one, and why the minimum is not smaller. */
export const PASSPHRASE_RULE_EXPLANATION =
  `Any program running as your account can read the keyring file and try passphrases offline; ` +
  `a long passphrase used nowhere else raises the cost of that guessing. Use at least ` +
  `${MIN_PASSPHRASE_CHARACTERS} characters, not one short pattern repeated.`;

/** Whether the whole text is its first half or less repeated (`abcabcab`, `pass pass pass `). */
function isShortUnitRepeated(characters: readonly string[]): boolean {
  for (let period = 1; period <= characters.length / 2; period += 1) {
    let repeats = true;
    for (let index = period; index < characters.length && repeats; index += 1) {
      repeats = characters[index] === characters[index - period];
    }
    if (repeats) return true;
  }
  return false;
}

/**
 * Why `passphrase` is not acceptable, or `undefined` when it is. Characters are counted after the
 * same NFKC normalization key derivation applies, so what is checked is what is used.
 */
export function passphraseProblem(passphrase: string): string | undefined {
  const characters = Array.from(passphrase.normalize('NFKC'));
  if (characters.length < MIN_PASSPHRASE_CHARACTERS) {
    return `That passphrase is too short: it needs at least ${MIN_PASSPHRASE_CHARACTERS} characters.`;
  }
  if (new Set(characters).size < MIN_DISTINCT_CHARACTERS || isShortUnitRepeated(characters)) {
    return 'That passphrase is a short pattern repeated, which a guesser tries early: choose one that is not.';
  }
  return undefined;
}
