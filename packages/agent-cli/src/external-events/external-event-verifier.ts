import { createAccessTokenVerifier } from '@robota-sdk/agent-transport/node';

import type {
  IAccessTokenVerifier,
  IAccessTokenVerifierConfig,
} from '@robota-sdk/agent-interface-transport';

/**
 * The CLI's one way to build an external-event grant's verifier: the real RFC 9068 access-token
 * verifier, handed to a session when it is built so no grant can bring its own.
 */
export function createExternalEventVerifier(
  config: IAccessTokenVerifierConfig,
): IAccessTokenVerifier {
  return createAccessTokenVerifier(config);
}
