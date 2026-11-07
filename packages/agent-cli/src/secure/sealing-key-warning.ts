/**
 * What the keyring commands say about a stored sealing public key that was not the one the keyring
 * derives, and the exit statuses that tell a repair that completed from one that did not. Every
 * command that unlocks — `verify`, `change-passphrase`, `migrate`, `compact` — words it the same way.
 */
import { fingerprint, getSealingPublicKey, type IKeyring } from '@robota-sdk/agent-keyring';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { SealingKeyMismatchError } from './key-holder.js';
import type { IKeyringStore } from '@robota-sdk/agent-local-host';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
/** The stored sealing public key was not the one the keyring derives; it was repaired and the command completed. */
export const EXIT_SEALING_KEY_REPAIRED = 2;
/**
 * The stored sealing public key was not the one the keyring derives, and the command did not
 * complete: it was cancelled or failed, or the repair itself was not confirmed. The warning was shown.
 */
export const EXIT_SEALING_KEY_MISMATCH_INCOMPLETE = 4;

/** Where a keyring command speaks. */
export interface ISecureOutput {
  readonly productRuntime: ICliRuntimeContext;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** A stored sealing public key that was not the derived one, as found: both are public fingerprints. */
export interface ISealingKeyMismatch {
  readonly stored: string;
  readonly derived: string;
}

export function fingerprintOf(keyring: IKeyring): string {
  return fingerprint(getSealingPublicKey(keyring));
}

/** Why a found mismatch was not repaired; the warning with the fingerprints follows separately. */
export function describeMismatchFailure(error: SealingKeyMismatchError, cliName: string): string {
  switch (error.repairFailure) {
    case 'changed':
      return 'The keyring changed while it was being unlocked, so the repair was not written.';
    case 'committed-unconfirmed':
      return `The repaired keyring was written, but confirming that it reached the disk failed; run \`${cliName} secure verify\` again.`;
    default:
      return `The repair could not be written [${error.repairFailure}].`;
  }
}

/** The fingerprint of the sealing key the file holds now, or `undefined` when it cannot be read. */
function fileFingerprint(store: IKeyringStore): string | undefined {
  try {
    const loaded = store.load();
    return loaded.status === 'present' ? fingerprintOf(loaded.keyring) : undefined;
  } catch {
    return undefined; // allow-fallback: the warning then says the file was not confirmed repaired.
  }
}

/**
 * The warning a found mismatch is owed whatever else happened, and whether the file holds the
 * derived key again: that is read from the file at the end, not assumed from what was attempted.
 */
export function warnSealingKeyMismatch(
  store: IKeyringStore,
  options: ISecureOutput,
  mismatch: ISealingKeyMismatch,
): boolean {
  const holdsDerivedKey = fileFingerprint(store) === mismatch.derived;
  const cliName = options.productRuntime.vocabulary.cliName;
  options.stderr(
    [
      'WARNING: the sealing public key in the keyring file was changed by something other than this keyring.',
      `  stored in the file:     ${mismatch.stored}`,
      `  your keyring derives:   ${mismatch.derived}`,
      holdsDerivedKey
        ? 'The file has been repaired and holds the derived key again.'
        : `The file still holds a key other than the derived one; run \`${cliName} secure verify\` to repair it.`,
      'Anything sealed while the keyring was locked since you last unlocked it may have been sealed to a',
      'key you cannot open, and whatever changed the file may be able to read it. Find out what wrote',
      'this file before trusting new records.',
    ].join('\n') + '\n',
  );
  return holdsDerivedKey;
}

export function mismatchOf(error: SealingKeyMismatchError): ISealingKeyMismatch {
  return { stored: error.storedFingerprint, derived: error.derivedFingerprint };
}

export function missingKeyring(store: IKeyringStore, options: ISecureOutput): number {
  options.stderr(
    `There is no keyring at ${store.path}. Run \`${options.productRuntime.vocabulary.cliName} secure setup\` first.\n`,
  );
  return EXIT_FAILED;
}
