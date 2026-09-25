/**
 * Who may reach a session through a remote resource server, decided from an OAuth access token.
 *
 * This sits beside `admission.ts` and speaks its vocabulary: an admission is a decision about a
 * peer, secure by default, and a refusal says WHY in a stable word rather than in prose. The shape
 * is declared here because it is a contract; the verifier that produces it needs cryptography and
 * the network, so it lives in `@robota-sdk/agent-transport/node`.
 *
 * ## Single-tenant, on purpose
 *
 * An issuer, an audience and a scope together admit anyone that issuer is willing to hand a token
 * to. A host that serves one shared session hands every admitted peer full control of the agent,
 * so that set is too wide: the configuration also names the subjects or clients allowed in, and a
 * verifier refuses to be built without one. This is a single-tenant contract and says so; a
 * multi-tenant host needs per-principal sessions, which this does not model.
 *
 * ## Content-free
 *
 * A verdict never carries the token or any claim value. Refusals name a reason from a closed set;
 * an admission says only that the peer was admitted. A caller that logs a verdict therefore cannot
 * leak a bearer credential or a principal's identity through it.
 */

/** The signing algorithms a verifier may be configured to accept. `none` and HMAC are not among them. */
export type TAccessTokenAlgorithm = 'RS256' | 'ES256' | 'EdDSA';

/**
 * Why a token was refused. Stable words, so a caller can count and route refusals without parsing
 * a message.
 *
 * - `oversize` — longer than the configured bound; nothing was parsed.
 * - `malformed` — not a compact JWS carrying a JSON claim set, or a required claim is absent.
 * - `wrong-type` — the header `typ` is not `at+jwt` (an ID token, or an untyped JWT).
 * - `unsupported-algorithm` — the header `alg` is not one the verifier was configured with.
 * - `ambiguous-key` — no `kid`, and the key set holds more than one key.
 * - `unknown-key` — no key with that `kid`, even after a refetch.
 * - `key-mismatch` — the selected key's type, curve, `alg` or `use` disagrees with the token.
 * - `bad-signature` — the signature does not verify under the selected key.
 * - `wrong-issuer` — `iss` is not exactly the configured issuer.
 * - `wrong-audience` — `aud` does not name the configured resource.
 * - `expired` / `not-yet-valid` — outside `exp` / `nbf`, after the allowed clock skew.
 * - `missing-scope` — a required scope is not granted.
 * - `principal-not-allowed` — neither the subject nor the client is on the allowlist.
 * - `keys-unavailable` — the issuer's metadata or key set could not be obtained; the verifier fails
 *   closed.
 */
export type TAccessTokenRefusal =
  | 'oversize'
  | 'malformed'
  | 'wrong-type'
  | 'unsupported-algorithm'
  | 'ambiguous-key'
  | 'unknown-key'
  | 'key-mismatch'
  | 'bad-signature'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'expired'
  | 'not-yet-valid'
  | 'missing-scope'
  | 'principal-not-allowed'
  | 'keys-unavailable';

/** The outcome of checking one token. There is no third state. */
export type TAccessTokenAdmission =
  { readonly admitted: true } | { readonly admitted: false; readonly refusal: TAccessTokenRefusal };

/** How a host asks for an access-token verifier. */
export interface IAccessTokenVerifierConfig {
  /** The authorization server's issuer identifier, an `https` URL; `iss` must equal it exactly. */
  readonly issuer: string;
  /** The public URL of this resource server; `aud` must name it. */
  readonly resource: string;
  /** Algorithms accepted for the token signature. At least one. */
  readonly algorithms: readonly TAccessTokenAlgorithm[];
  /** Scopes every admitted token must carry. */
  readonly requiredScopes: readonly string[];
  /** Subjects (`sub`) admitted. With `allowedClients`, at least one entry across both is required. */
  readonly allowedSubjects?: readonly string[];
  /** Clients (`client_id`) admitted. */
  readonly allowedClients?: readonly string[];
}

/** Decides whether a presented bearer token admits its peer. Never throws; refusals are returned. */
export interface IAccessTokenVerifier {
  verify(token: string): Promise<TAccessTokenAdmission>;
}
