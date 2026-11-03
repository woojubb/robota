/**
 * The framing of a sealed artifact, which a reader needs even when it holds no sealer: a store that
 * was handed no keys must still tell "this file is sealed, I cannot read it" from "this file is
 * damaged", and only the framing answers that.
 *
 * Sealed bytes begin with a magic, `RSL` and a version digit; a sealed line begins with the magic and
 * a colon. Any version counts as sealed, so a framing written by a later build is recognised as
 * sealed by an older reader rather than mistaken for plaintext and replaced; only the version this
 * build writes (`RSL1`) is one it can open. Neither check looks at the content, so neither proves
 * the artifact opens.
 */

/** The four characters every artifact this build seals starts with. */
export const SEALED_ARTIFACT_MAGIC = 'RSL1';

/** What a sealed line this build writes starts with: the magic and a colon. */
export const SEALED_ARTIFACT_LINE_PREFIX = `${SEALED_ARTIFACT_MAGIC}:`;

/**
 * The most any sealer's `sealBytes` may add to its plaintext, magic included. A reader that holds a
 * plaintext budget sizes its raw read of a sealed file by it without knowing the sealer's layout;
 * generous on purpose, so a later framing never has to change readers.
 */
export const SEALED_ARTIFACT_MAX_OVERHEAD_BYTES = 4096;

/** The part of the magic every framing version shares; the character after it is the version. */
const SEALED_FAMILY = 'RSL';
const DIGIT_ZERO = '0'.charCodeAt(0);
const DIGIT_NINE = '9'.charCodeAt(0);

function startsWithFamily(at: (index: number) => number, length: number): boolean {
  if (length < SEALED_ARTIFACT_MAGIC.length) return false;
  for (let index = 0; index < SEALED_FAMILY.length; index += 1) {
    if (at(index) !== SEALED_FAMILY.charCodeAt(index)) return false;
  }
  const version = at(SEALED_FAMILY.length);
  return version >= DIGIT_ZERO && version <= DIGIT_NINE;
}

/**
 * Whether `stored` starts with a sealed-bytes magic of any version. Needs no sealer; a sealer's
 * `isSealedBytes` is this check.
 */
export function isSealedArtifactBytes(stored: Uint8Array): boolean {
  return startsWithFamily((index) => stored[index] ?? -1, stored.length);
}

/** Whether `stored` is sealed in the framing version this build writes, and so one it can open. */
export function isCurrentSealedArtifactBytes(stored: Uint8Array): boolean {
  if (!isSealedArtifactBytes(stored)) return false;
  return stored[SEALED_FAMILY.length] === SEALED_ARTIFACT_MAGIC.charCodeAt(SEALED_FAMILY.length);
}

/**
 * Whether `stored` starts with a sealed-line prefix of any version. Needs no sealer; a sealer's
 * `isSealedLine` is this check.
 */
export function isSealedArtifactLine(stored: string): boolean {
  return (
    startsWithFamily((index) => stored.charCodeAt(index), stored.length) &&
    stored.charAt(SEALED_ARTIFACT_MAGIC.length) === ':'
  );
}

/** Whether `stored` is a sealed line in the framing version this build writes. */
export function isCurrentSealedArtifactLine(stored: string): boolean {
  return stored.startsWith(SEALED_ARTIFACT_LINE_PREFIX);
}
