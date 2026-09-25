/**
 * The access-token verifier behind `IAccessTokenVerifier`.
 *
 * The cryptography is `jose`'s, not ours: signature verification, claim validation and key import
 * are the parts most often got subtly wrong by hand. What this module adds is the policy around
 * them — which tokens are even offered to `jose`, which key a token may be checked against, and
 * where that key may be fetched from.
 *
 * Keys are found through the issuer's own metadata (RFC 8414, then OpenID discovery) and fetched
 * through the shared egress boundary with private-address reach granted to the issuer's host only,
 * so an internal authorization server works without opening the resource server's egress to every
 * internal address. Every fetch is `https`, byte-bounded, and refuses redirects: a key set is the
 * root of trust for every admission after it, and a redirect is a second origin nobody configured.
 *
 * The key set is cached and refetched only when a token names a `kid` the cache does not hold, at
 * most once per interval, so a stream of tokens with invented `kid`s cannot turn this into a
 * request amplifier against the issuer. When keys cannot be obtained the verifier refuses: an
 * outage is not a reason to admit.
 */

import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';

import { fetchWithEgressPolicy } from '@robota-sdk/agent-core/node';
import type { IEgressDeps } from '@robota-sdk/agent-core/node';
import type {
  IAccessTokenVerifier,
  IAccessTokenVerifierConfig,
  TAccessTokenAdmission,
  TAccessTokenAlgorithm,
  TAccessTokenRefusal,
} from '@robota-sdk/agent-interface-transport';
import type { JWK, JWTPayload } from 'jose';

/** Longest token offered to the parser. Real access tokens are a few hundred bytes to a few KiB. */
const MAX_TOKEN_LENGTH = 8192;
/** Byte cap on a metadata document or key set. */
const MAX_DOCUMENT_BYTES = 64 * 1024;
/** Keys accepted from one key set. */
const MAX_KEYS = 32;
/** Deadline for one metadata or key-set exchange. */
const FETCH_TIMEOUT_MS = 10_000;
/** Minimum gap between two key-set fetches, whatever triggered them. */
const MIN_REFETCH_INTERVAL_MS = 30_000;
/** Clock skew tolerated on `exp` and `nbf`, in seconds. */
const CLOCK_SKEW_SECONDS = 60;
const ACCESS_TOKEN_TYP = 'at+jwt';

const SUPPORTED_ALGORITHMS: readonly TAccessTokenAlgorithm[] = ['RS256', 'ES256', 'EdDSA'];

/** The key shape each algorithm requires. A key that disagrees is never offered to `jose`. */
const KEY_SHAPE: Readonly<Record<TAccessTokenAlgorithm, { kty: string; crv?: string }>> = {
  RS256: { kty: 'RSA' },
  ES256: { kty: 'EC', crv: 'P-256' },
  EdDSA: { kty: 'OKP', crv: 'Ed25519' },
};

/** What the verifier reaches outward through. Injected in tests; defaults to the real network. */
export interface IAccessTokenVerifierDeps {
  readonly fetch?: IEgressDeps['fetch'];
  readonly lookup?: IEgressDeps['lookup'];
  /** Milliseconds since the epoch. */
  readonly now?: () => number;
}

interface IKeyCache {
  keys: readonly JWK[] | undefined;
  jwksUri: string | undefined;
  lastFetchAt: number | undefined;
  inflight: Promise<void> | undefined;
}

class Refused {
  constructor(readonly refusal: TAccessTokenRefusal) {}
}

/**
 * Build a verifier for one issuer and one resource.
 *
 * @throws when the configuration cannot describe a safe verifier: a non-`https` issuer, no
 * algorithm or an unsupported one, no required scope, or no allowlisted subject or client. The
 * last is the single-tenant rule: without it any holder of a token from the issuer is admitted.
 */
export function createAccessTokenVerifier(
  config: IAccessTokenVerifierConfig,
  deps: IAccessTokenVerifierDeps = {},
): IAccessTokenVerifier {
  const issuerUrl = validateConfig(config);
  const now = deps.now ?? Date.now;
  const egressDeps: IEgressDeps = { fetch: deps.fetch, lookup: deps.lookup };
  const issuerHost = issuerUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const cache: IKeyCache = {
    keys: undefined,
    jwksUri: undefined,
    lastFetchAt: undefined,
    inflight: undefined,
  };
  const allowedSubjects = new Set(config.allowedSubjects ?? []);
  const allowedClients = new Set(config.allowedClients ?? []);

  async function fetchJson(url: string): Promise<unknown> {
    if (new URL(url).protocol !== 'https:') return undefined;
    const result = await fetchWithEgressPolicy(
      url,
      {
        headers: { accept: 'application/json' },
        timeoutMs: FETCH_TIMEOUT_MS,
        maxResponseBytes: MAX_DOCUMENT_BYTES,
      },
      { allowedHosts: [issuerHost], maxRedirects: 0 },
      egressDeps,
    );
    if (!result.ok || result.status !== 200) return undefined;
    return JSON.parse(new TextDecoder().decode(result.body)) as unknown;
  }

  async function discoverJwksUri(): Promise<string | undefined> {
    for (const url of metadataUrls(issuerUrl)) {
      const metadata = await fetchJson(url).catch(() => undefined);
      if (!isRecord(metadata)) continue;
      // RFC 8414 §3.3: metadata naming another issuer must not be used — and a server that
      // answered with the wrong issuer is not one to ask a second question of.
      if (metadata.issuer !== config.issuer) return undefined;
      const jwksUri = metadata.jwks_uri;
      if (typeof jwksUri !== 'string' || !URL.canParse(jwksUri)) return undefined;
      return new URL(jwksUri).protocol === 'https:' ? jwksUri : undefined;
    }
    return undefined;
  }

  async function fetchKeys(): Promise<void> {
    cache.lastFetchAt = now();
    try {
      cache.jwksUri ??= await discoverJwksUri();
      if (cache.jwksUri === undefined) return;
      const keys = parseKeySet(await fetchJson(cache.jwksUri));
      if (keys !== undefined) cache.keys = keys;
    } catch {
      // allow-fallback: a failed fetch leaves the cache as it was. A verifier with no keys refuses
      // every token (`keys-unavailable`), which is the fail-closed direction.
    }
  }

  /** Refetch unless one ran within the interval. Concurrent callers share one fetch. */
  async function refreshKeys(): Promise<void> {
    if (cache.inflight !== undefined) return cache.inflight;
    if (cache.lastFetchAt !== undefined && now() - cache.lastFetchAt < MIN_REFETCH_INTERVAL_MS) {
      return;
    }
    cache.inflight = fetchKeys().finally(() => {
      cache.inflight = undefined;
    });
    return cache.inflight;
  }

  async function selectKey(kid: string | undefined): Promise<JWK> {
    if (cache.keys === undefined) await refreshKeys();
    if (cache.keys === undefined) throw new Refused('keys-unavailable');
    if (kid === undefined) {
      if (cache.keys.length > 1) throw new Refused('ambiguous-key');
      const only = cache.keys[0];
      if (only === undefined) throw new Refused('unknown-key');
      return only;
    }
    let found = cache.keys.find((key) => key.kid === kid);
    if (found === undefined) {
      await refreshKeys();
      found = cache.keys.find((key) => key.kid === kid);
    }
    if (found === undefined) throw new Refused('unknown-key');
    return found;
  }

  async function check(token: string): Promise<TAccessTokenAdmission> {
    if (typeof token !== 'string' || token.length === 0) throw new Refused('malformed');
    if (token.length > MAX_TOKEN_LENGTH) throw new Refused('oversize');

    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new Refused('malformed');
    }
    if (typeof header.typ !== 'string' || normalizeTyp(header.typ) !== ACCESS_TOKEN_TYP) {
      throw new Refused('wrong-type');
    }
    const alg = config.algorithms.find((allowed) => allowed === header.alg);
    if (alg === undefined) throw new Refused('unsupported-algorithm');
    if (header.kid !== undefined && typeof header.kid !== 'string') throw new Refused('malformed');

    const jwk = await selectKey(header.kid);
    if (!keyAgrees(jwk, alg)) throw new Refused('key-mismatch');
    let key: Awaited<ReturnType<typeof importJWK>>;
    try {
      key = await importJWK(jwk, alg);
    } catch {
      throw new Refused('key-mismatch');
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: [alg],
        typ: ACCESS_TOKEN_TYP,
        clockTolerance: CLOCK_SKEW_SECONDS,
        currentDate: new Date(now()),
        requiredClaims: ['exp', 'sub', 'client_id'],
      }));
    } catch (error) {
      throw new Refused(refusalFor(error));
    }

    const granted = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    if (!config.requiredScopes.every((scope) => granted.includes(scope))) {
      throw new Refused('missing-scope');
    }
    const subject = payload.sub;
    const client = payload.client_id;
    const allowed =
      (typeof subject === 'string' && allowedSubjects.has(subject)) ||
      (typeof client === 'string' && allowedClients.has(client));
    if (!allowed) throw new Refused('principal-not-allowed');
    return { admitted: true };
  }

  return {
    async verify(token: string): Promise<TAccessTokenAdmission> {
      try {
        return await check(token);
      } catch (error) {
        // Only the reason word leaves: never the token, a claim, or an underlying error message.
        return { admitted: false, refusal: error instanceof Refused ? error.refusal : 'malformed' };
      }
    },
  };
}

function validateConfig(config: IAccessTokenVerifierConfig): URL {
  if (!URL.canParse(config.issuer)) throw new Error('access-token verifier: issuer is not a URL');
  const issuerUrl = new URL(config.issuer);
  if (issuerUrl.protocol !== 'https:' || issuerUrl.search !== '' || issuerUrl.hash !== '') {
    throw new Error('access-token verifier: issuer must be an https URL with no query or fragment');
  }
  if (!URL.canParse(config.resource)) {
    throw new Error('access-token verifier: resource is not a URL');
  }
  if (
    config.algorithms.length === 0 ||
    !config.algorithms.every((alg) => SUPPORTED_ALGORITHMS.includes(alg))
  ) {
    throw new Error(
      'access-token verifier: algorithms must be a non-empty subset of RS256, ES256, EdDSA',
    );
  }
  if (config.requiredScopes.length === 0) {
    throw new Error('access-token verifier: at least one required scope is needed');
  }
  const principals = (config.allowedSubjects?.length ?? 0) + (config.allowedClients?.length ?? 0);
  if (principals === 0) {
    throw new Error(
      'access-token verifier: name at least one allowed subject or client — this host is ' +
        'single-tenant, and issuer + audience + scope alone admit anyone the issuer serves',
    );
  }
  return issuerUrl;
}

/** RFC 8414 §3.1 inserts the well-known segment before the issuer's path; OpenID appends it. */
function metadataUrls(issuer: URL): readonly string[] {
  const path = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '');
  return [
    `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
    `${issuer.origin}${path}/.well-known/openid-configuration`,
  ];
}

function parseKeySet(body: unknown): readonly JWK[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.keys) || body.keys.length > MAX_KEYS) return undefined;
  return body.keys.filter((key): key is JWK => isRecord(key) && typeof key.kty === 'string');
}

function keyAgrees(jwk: JWK, alg: TAccessTokenAlgorithm): boolean {
  const shape = KEY_SHAPE[alg];
  if (jwk.kty !== shape.kty) return false;
  if (shape.crv !== undefined && jwk.crv !== shape.crv) return false;
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  if (jwk.use !== undefined && jwk.use !== 'sig') return false;
  if (jwk.key_ops !== undefined && !jwk.key_ops.includes('verify')) return false;
  // A public key set never carries private material; one that does is not a key set to trust.
  return jwk.d === undefined;
}

function refusalFor(error: unknown): TAccessTokenRefusal {
  const code = isRecord(error) ? error.code : undefined;
  const claim = isRecord(error) ? error.claim : undefined;
  switch (code) {
    case 'ERR_JWT_EXPIRED':
      return 'expired';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return 'bad-signature';
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return 'unsupported-algorithm';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (claim === 'iss') return 'wrong-issuer';
      if (claim === 'aud') return 'wrong-audience';
      if (claim === 'nbf') return 'not-yet-valid';
      if (claim === 'typ') return 'wrong-type';
      return 'malformed';
    default:
      return 'malformed';
  }
}

function normalizeTyp(typ: string): string {
  const lower = typ.toLowerCase();
  return lower.startsWith('application/') ? lower.slice('application/'.length) : lower;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
