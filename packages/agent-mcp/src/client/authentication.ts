/**
 * The client authentication port for remote MCP servers.
 *
 * A host registers an authenticator for ONE server identity; the HTTP transport asks it for headers
 * on every request it sends to that server, after the endpoint was admitted. OAuth and a dynamic
 * header helper each plug in here without the transport changing: the transport owns when to ask
 * and what a refusal means, the authenticator owns how a credential is obtained.
 *
 * What an authenticator returns is a credential. It never enters a projection, a log, an audit
 * record or an error message, and a failure is reported without the authenticator's own text.
 */

/** What the transport tells an authenticator about the request it is about to send. */
export interface IMCPAuthorizationRequest {
  readonly serverId: string;
  readonly securityIdentity: string;
  /** The admitted URL — the only one this transport ever speaks to. */
  readonly url: URL;
  readonly signal?: AbortSignal;
}

/** The server refused the credential. */
export interface IMCPAuthorizationRejection {
  readonly status: number;
  readonly wwwAuthenticate?: string;
}

export interface IMCPClientAuthenticator {
  /**
   * Headers for one request to this server. They override a static header of the same name — and
   * could override a protocol header too, which is the host's to avoid: the authenticator is
   * host-owned, never supplied by a definition.
   */
  authorize(request: IMCPAuthorizationRequest): Promise<Readonly<Record<string, string>>>;
  /**
   * The server answered 401 or 403. `retry` sends the request once more with fresh authorization;
   * `fail` refuses the connection. A second refusal always fails.
   */
  onRejected(rejection: IMCPAuthorizationRejection): Promise<'retry' | 'fail'>;
}

/** An authenticator, bound to the one server identity it may be asked about. */
export interface IMCPBoundAuthenticator {
  readonly serverId: string;
  readonly securityIdentity: string;
  readonly authenticator: IMCPClientAuthenticator;
}

/**
 * Why authentication refused a request:
 * - `authorize-failed` — the authenticator could not produce a credential;
 * - `rejected` — the server refused the credential and no retry was allowed or left.
 */
export type TMCPAuthenticationFailure = 'authorize-failed' | 'rejected';

/** A refused request, named without any credential or authenticator text. */
export class MCPAuthenticationError extends Error {
  constructor(readonly reason: TMCPAuthenticationFailure) {
    super(
      reason === 'authorize-failed'
        ? 'MCP authentication failed: no credential could be obtained for this server'
        : 'MCP authentication failed: the server refused the credential',
    );
    this.name = 'MCPAuthenticationError';
  }
}

/** Authentication keys a definition may declare that this version does not implement yet. */
export const UNSUPPORTED_AUTHENTICATION_KEYS = ['oauth', 'headersHelper'] as const;
