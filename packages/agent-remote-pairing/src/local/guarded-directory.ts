/**
 * SEC-010: CREATING the directory whose permissions are the proof.
 *
 * `peer-credential.ts` answers "is this directory one only this user can enter". This answers "make
 * one, and tell me if you could not". They are two halves of a single fact, and they live beside
 * each other because a repository where one module decides what `guarded` means and another decides
 * how to build it has two definitions of `guarded` — and the day they disagree, the one that builds
 * wins silently.
 *
 * WHERE the directory goes is NOT decided here. That is composition: `agent-cli` knows about
 * `XDG_RUNTIME_DIR`, about the user's home, and about which of them exists on this host. This module
 * knows only what has to be true of whatever path it is handed, which is why it can be tested
 * without a filesystem layout.
 *
 * ## Creation is not the same as validation, and doing both is the point
 *
 * `mkdir(path, { mode: 0o700, recursive: true })` does not guarantee a 0700 directory, for one
 * reason that survives scrutiny: **if the directory already exists, `mkdir` succeeds without
 * touching its mode at all.** A directory some earlier process — or some other program — left at
 * 0777 is then adopted as ours, with a successful return and no signal.
 *
 * A note on the reason that does NOT survive scrutiny, recorded because it was the first
 * justification written here and it was wrong: the umask cannot widen this. It only ever CLEARS
 * bits, so a requested 0700 can come back 0600 but never 0755. The test that claimed to prove the
 * umask case passed with the `chmod` removed, which is what exposed it — an assertion that holds
 * either way was asserting nothing.
 *
 * So: create, then `chmod` unconditionally, then VALIDATE with the same function that validates a
 * directory we did not create. The last step is what makes the first two checkable rather than
 * hopeful, and it is the only one that catches an owner we did not expect.
 */

import { chmodSync, mkdirSync } from 'node:fs';

import {
  admitLocalPeerDirectory,
  refuseLocalPeer,
  type IGuardedDirectoryOptions,
  type ILocalPeerAdmission,
} from './peer-credential.js';

/** Owner-only. The whole proof is that no other account can traverse it. */
export const GUARDED_MODE = 0o700;

export interface IEnsureGuardedOptions extends IGuardedDirectoryOptions {
  /** Directory creator, injected so the failure paths are reachable without a real filesystem. */
  readonly makeDirectory?: (target: string, mode: number) => void;
  /** Mode setter, injected for the same reason. */
  readonly setMode?: (target: string, mode: number) => void;
}

/**
 * Make a rendezvous directory that meets the guarantee, or say why it does not.
 *
 * Returns the same `ILocalPeerAdmission` shape a validation returns, so a caller never has to hold
 * two vocabularies for one question. An admitted result means the directory exists AND was verified
 * after creation — not that `mkdir` returned without throwing.
 */
export function ensureGuardedDirectory(
  directory: string,
  options: IEnsureGuardedOptions,
): ILocalPeerAdmission {
  const makeDirectory =
    options.makeDirectory ??
    ((target: string, mode: number): void => {
      mkdirSync(target, { recursive: true, mode });
    });
  const setMode =
    options.setMode ?? ((target: string, mode: number): void => chmodSync(target, mode));

  try {
    makeDirectory(directory, GUARDED_MODE);
  } catch (error) {
    // allow-fallback: this substitutes no alternative directory — it converts a failed creation
    // into a REFUSAL, which is the same terminal answer the validator gives. Proceeding to chmod a
    // directory that was not created would report a mode change on nothing.
    return refuseLocalPeer(
      `the rendezvous directory ${directory} could not be created: ` +
        `${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  try {
    // Unconditional, and this is the load-bearing line: `mkdir` with `recursive: true` succeeds on
    // an EXISTING directory without touching its mode, so whatever it was left at — 0777 by some
    // earlier process — would stand, with a successful return and no signal.
    setMode(directory, GUARDED_MODE);
  } catch (error) {
    // allow-fallback: same shape — a directory whose mode could not be set is refused, never used
    // at whatever mode it happens to have.
    return refuseLocalPeer(
      `the rendezvous directory ${directory} could not be set to mode 0700: ` +
        `${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  // Validated with the SAME function that judges a directory we did not create. Trusting our own
  // two calls would mean the create path is the one place the guarantee is assumed rather than
  // checked — and it is the place a wrong umask, a mount option or a hostile pre-created directory
  // would land.
  return admitLocalPeerDirectory(directory, options);
}
