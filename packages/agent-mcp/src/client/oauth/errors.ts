/**
 * OAuth failures, named by a fixed reason only.
 *
 * An OAuth exchange carries codes, verifiers, tokens and client secrets, and an authorization
 * server's error text can echo any of them back. None of that reaches an error message, a
 * diagnostic or a log: a failure says which step refused, never what was sent or received.
 */

export type TMCPOAuthFailure =
  /** The egress policy refused a destination, a redirect, or an oversized response. */
  | 'egress-refused'
  /** A metadata or token response was not the document it should be. */
  | 'response-invalid'
  | 'discovery-failed'
  /** The protected-resource metadata describes a different resource than the server. */
  | 'resource-mismatch'
  /** A `resource_metadata` link pointed away from the server's own origin. */
  | 'resource-metadata-cross-origin'
  /** The authorization server metadata names a different issuer than the one asked. */
  | 'issuer-mismatch'
  /** The server, an authorization server or one of its endpoints is not `https`. */
  | 'insecure-endpoint'
  | 'registration-unavailable'
  | 'registration-failed'
  /** A client secret was supplied for a client the definition does not pre-register. */
  | 'client-secret-without-client-id'
  | 'callback-unavailable'
  | 'callback-timeout'
  | 'callback-invalid'
  /** The authorization server redirected back with an error instead of a code. */
  | 'authorization-denied'
  /** RFC 9207: the redirect's `iss` is missing where promised, or names another issuer. */
  | 'issuer-parameter-mismatch'
  | 'browser-failed'
  | 'token-exchange-failed'
  | 'token-type-unsupported'
  | 'refresh-failed'
  /** No usable credential is stored: a new sign-in is needed. */
  | 'login-required'
  | 'store-failed'
  | 'lock-timeout'
  | 'cancelled';

export class MCPOAuthError extends Error {
  constructor(readonly reason: TMCPOAuthFailure) {
    super(`MCP OAuth failed (${reason})`);
    this.name = 'MCPOAuthError';
  }
}

/** `error` itself when it is already named, otherwise the given reason — never the error's text. */
export function asOAuthError(error: unknown, reason: TMCPOAuthFailure): MCPOAuthError {
  if (error instanceof MCPOAuthError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new MCPOAuthError('cancelled');
  return new MCPOAuthError(reason);
}
