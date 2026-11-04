/**
 * The mint of user read requests: the one place a read is declared started by the person.
 *
 * Only the terminal UI's action modules import it, from the handler of a key the person pressed;
 * `.dependency-cruiser.cjs` lists them and refuses every other importer, and the package does not
 * export it. Adding an importer is a deliberate edit of that rule, reviewed like the action itself.
 */
import { recordMintedRequest } from './minted-read-requests.js';

import type { TReadPurpose, TUserReadRequest } from './key-custody-port.js';

export function mintUserReadRequest(purpose: TReadPurpose): TUserReadRequest {
  // The brand exists only in the type; the value is the purpose, frozen so no holder changes it,
  // and recorded, so a holder can tell it from a cast of the same shape.
  const request = Object.freeze({ purpose }) as TUserReadRequest;
  recordMintedRequest(request);
  return request;
}
