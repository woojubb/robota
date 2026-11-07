/**
 * How the terminal UI asks the process that holds the keys to read something sealed, and the only
 * shape such a request can take.
 *
 * Locked is write-only: a process asks for the passphrase only when a read the person started needs
 * the keys. Store reads never say why they read (many are not the person's: a restore, a re-tag, a
 * migration), so the reason lives on the prompt instead. `ensureReadable` takes a request only the
 * terminal UI's action modules can make, from the person's own key press, through the mint in
 * `user-read-request-mint.ts`. Two things hold that line: `deps:check` refuses an import of the mint
 * from anywhere but those modules, and the mint records what it makes, so the holder checks a request
 * with {@link isUserReadRequest} and refuses one the mint did not make, whatever its type says. The
 * product words each purpose.
 */
import { wasMintedRequest } from './minted-read-requests.js';

/** Never exported: a type that names it can only be satisfied through the mint. */
declare const userReadRequestBrand: unique symbol;

/**
 * Why a read the person started needs the keys. Each purpose is added together with the UI action
 * that mints it, and the product must word it before it compiles.
 */
export type TReadPurpose = 'continue-fork';

/**
 * A read the person started, from a UI event; made only by `mintUserReadRequest`. The brand stops a
 * literal of this shape; a cast still compiles, which is why {@link isUserReadRequest} exists.
 */
export type TUserReadRequest = {
  readonly purpose: TReadPurpose;
  readonly [userReadRequestBrand]: true;
};

/**
 * Whether the mint made `value`. A cast or a copy of a request is not one. It answers that and
 * nothing more, and makes nothing, so any module may ask.
 */
export function isUserReadRequest(value: unknown): value is TUserReadRequest {
  return wasMintedRequest(value);
}

/**
 * `readable`: the keys are open, already or because the person just unlocked. `declined`: the person
 * was asked and cancelled, or the passphrase did not unlock. `unavailable`: this process could not
 * ask (no terminal it can hand over, or no keyring to unlock), so the read stays locked.
 */
export type TReadability = 'readable' | 'declined' | 'unavailable';

/** What the terminal UI may ask of the keys' holder; absent where secure mode is off. */
export interface IKeyCustodyPort {
  /**
   * Resolves `readable` at once while unlocked. Otherwise it asks for the passphrase on the
   * terminal, under the line that words the request's purpose, one prompt at a time. A request the
   * mint did not make is `unavailable`, and nothing is asked.
   */
  ensureReadable(request: TUserReadRequest): Promise<TReadability>;
}
