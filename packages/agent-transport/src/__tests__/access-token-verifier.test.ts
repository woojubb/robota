import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { createAccessTokenVerifier } from '../node/access-token-verifier.js';

import type {
  IAccessTokenVerifier,
  IAccessTokenVerifierConfig,
  TAccessTokenAdmission,
  TAccessTokenAlgorithm,
  TAccessTokenRefusal,
} from '@robota-sdk/agent-interface-transport';
import type { CryptoKey, JWK } from 'jose';

const ISSUER = 'https://auth.example.com';
const RESOURCE = 'https://agent.example.com/mcp';
const METADATA_URL = `${ISSUER}/.well-known/oauth-authorization-server`;
const JWKS_URL = `${ISSUER}/jwks.json`;
const START_MS = 1_800_000_000_000;
const PUBLIC_ADDRESS = '93.184.216.34';

interface ISigner {
  readonly alg: TAccessTokenAlgorithm;
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
}

async function signer(alg: TAccessTokenAlgorithm, kid: string): Promise<ISigner> {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  const jwk = await exportJWK(publicKey);
  return { alg, kid, privateKey, jwk: { ...jwk, kid, alg, use: 'sig' } };
}

interface IMintOptions {
  readonly header?: Record<string, unknown>;
  readonly claims?: Record<string, unknown>;
  readonly issuer?: string;
  readonly audience?: string;
  readonly expOffset?: number;
  readonly nbfOffset?: number;
}

async function mint(key: ISigner, clock: IClock, options: IMintOptions = {}): Promise<string> {
  const nowSeconds = Math.floor(clock.ms / 1000);
  const jwt = new SignJWT({
    scope: 'agent:control agent:read',
    client_id: 'cli-1',
    ...options.claims,
  })
    .setProtectedHeader({ alg: key.alg, typ: 'at+jwt', kid: key.kid, ...options.header })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? RESOURCE)
    .setSubject('alice')
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + (options.expOffset ?? 300));
  if (options.nbfOffset !== undefined) jwt.setNotBefore(nowSeconds + options.nbfOffset);
  return jwt.sign(key.privateKey);
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

interface IClock {
  ms: number;
}

type TRoute = () => Response | Promise<Response>;

/** A stubbed issuer: routes by URL, records every request that reached the network. */
function issuerNetwork(routes: Record<string, TRoute>) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    return route();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function standardRoutes(keys: () => readonly JWK[]): Record<string, TRoute> {
  return {
    [METADATA_URL]: () => json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
    [JWKS_URL]: () => json({ keys: keys() }),
  };
}

const BASE_CONFIG: IAccessTokenVerifierConfig = {
  issuer: ISSUER,
  resource: RESOURCE,
  algorithms: ['RS256', 'ES256', 'EdDSA'],
  requiredScopes: ['agent:control'],
  allowedSubjects: ['alice'],
};

interface IHarness {
  readonly verifier: IAccessTokenVerifier;
  readonly calls: string[];
  readonly clock: IClock;
  readonly lookups: string[];
}

function harness(
  routes: Record<string, TRoute>,
  config: Partial<IAccessTokenVerifierConfig> = {},
  addresses: Record<string, string> = {},
): IHarness {
  const clock: IClock = { ms: START_MS };
  const { calls, fetch } = issuerNetwork(routes);
  const lookups: string[] = [];
  const verifier = createAccessTokenVerifier(
    { ...BASE_CONFIG, ...config },
    {
      fetch,
      lookup: async (hostname) => {
        lookups.push(hostname);
        return [addresses[hostname] ?? PUBLIC_ADDRESS];
      },
      now: () => clock.ms,
      monotonicNow: () => clock.ms,
    },
  );
  return { verifier, calls, clock, lookups };
}

async function expectRefused(
  verifier: IAccessTokenVerifier,
  token: string,
  refusal: TAccessTokenRefusal,
): Promise<void> {
  const result = await verifier.verify(token);
  // Exact equality: a refusal carries the reason word and nothing else.
  expect(result).toStrictEqual({ admitted: false, refusal });
}

async function expectAdmitted(verifier: IAccessTokenVerifier, token: string): Promise<void> {
  expect(await verifier.verify(token)).toStrictEqual({ admitted: true });
}

describe('createAccessTokenVerifier', () => {
  describe('construction', () => {
    it('refuses a configuration that names no allowed subject or client (single-tenant)', () => {
      expect(() =>
        createAccessTokenVerifier({ ...BASE_CONFIG, allowedSubjects: [], allowedClients: [] }),
      ).toThrow(/single-tenant/);
    });

    it('refuses an http issuer', () => {
      expect(() =>
        createAccessTokenVerifier({ ...BASE_CONFIG, issuer: 'http://auth.example.com' }),
      ).toThrow(/https/);
    });

    it('refuses an algorithm outside RS256/ES256/EdDSA, and an empty list', () => {
      expect(() =>
        createAccessTokenVerifier({
          ...BASE_CONFIG,
          algorithms: ['HS256' as TAccessTokenAlgorithm],
        }),
      ).toThrow(/algorithms/);
      expect(() => createAccessTokenVerifier({ ...BASE_CONFIG, algorithms: [] })).toThrow(
        /algorithms/,
      );
    });

    it('refuses a configuration with no required scope', () => {
      expect(() => createAccessTokenVerifier({ ...BASE_CONFIG, requiredScopes: [] })).toThrow(
        /scope/,
      );
    });
  });

  describe('accepts', () => {
    for (const alg of ['RS256', 'ES256', 'EdDSA'] as const) {
      it(`a valid ${alg} access token`, async () => {
        const key = await signer(alg, `${alg}-1`);
        const h = harness(standardRoutes(() => [key.jwk]));
        await expectAdmitted(h.verifier, await mint(key, h.clock));
      });
    }

    it('an application/at+jwt typ, and a token admitted by client allowlist alone', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(
        standardRoutes(() => [key.jwk]),
        {
          allowedSubjects: [],
          allowedClients: ['cli-1'],
        },
      );
      await expectAdmitted(
        h.verifier,
        await mint(key, h.clock, { header: { typ: 'application/at+jwt' } }),
      );
    });

    it('an upper-case AT+JWT typ (media types are case-insensitive)', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectAdmitted(h.verifier, await mint(key, h.clock, { header: { typ: 'AT+JWT' } }));
    });

    it('a token without kid when the key set holds exactly one key', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectAdmitted(h.verifier, await mint(key, h.clock, { header: { kid: undefined } }));
    });

    it('finds keys through OpenID discovery when RFC 8414 metadata is absent', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness({
        [`${ISSUER}/.well-known/openid-configuration`]: () =>
          json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => json({ keys: [key.jwk] }),
      });
      await expectAdmitted(h.verifier, await mint(key, h.clock));
    });

    it('inserts the well-known segment before an issuer path (RFC 8414 §3.1)', async () => {
      const key = await signer('ES256', 'k1');
      const issuer = `${ISSUER}/tenant-a`;
      const h = harness(
        {
          [`${ISSUER}/.well-known/oauth-authorization-server/tenant-a`]: () =>
            json({ issuer, jwks_uri: JWKS_URL }),
          [JWKS_URL]: () => json({ keys: [key.jwk] }),
        },
        { issuer },
      );
      await expectAdmitted(h.verifier, await mint(key, h.clock, { issuer }));
    });
  });

  describe('token type and size', () => {
    it('refuses an ID token (typ JWT) and an untyped token', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectRefused(
        h.verifier,
        await mint(key, h.clock, { header: { typ: 'JWT' } }),
        'wrong-type',
      );
      await expectRefused(
        h.verifier,
        await mint(key, h.clock, { header: { typ: undefined } }),
        'wrong-type',
      );
      expect(h.calls).toEqual([]);
    });

    it('refuses an oversize token without parsing it or touching the network', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectRefused(h.verifier, 'a'.repeat(9000), 'oversize');
      expect(h.calls).toEqual([]);
    });

    it('refuses garbage as malformed', async () => {
      const h = harness(standardRoutes(() => []));
      await expectRefused(h.verifier, 'not-a-jwt', 'malformed');
      await expectRefused(h.verifier, '', 'malformed');
    });

    it('refuses a token missing a required claim (client_id)', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectRefused(
        h.verifier,
        await mint(key, h.clock, { claims: { client_id: undefined } }),
        'malformed',
      );
    });
  });

  describe('algorithms and keys', () => {
    it('refuses alg none', async () => {
      const h = harness(standardRoutes(() => []));
      const now = Math.floor(START_MS / 1000);
      const token = `${b64url({ alg: 'none', typ: 'at+jwt' })}.${b64url({
        iss: ISSUER,
        aud: RESOURCE,
        sub: 'alice',
        client_id: 'cli-1',
        scope: 'agent:control',
        exp: now + 300,
      })}.`;
      await expectRefused(h.verifier, token, 'unsupported-algorithm');
    });

    it('refuses HS256, even keyed with a published public key', async () => {
      const key = await signer('RS256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      const secret = new TextEncoder().encode(JSON.stringify(key.jwk));
      const now = Math.floor(START_MS / 1000);
      const token = await new SignJWT({ scope: 'agent:control', client_id: 'cli-1' })
        .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'k1' })
        .setIssuer(ISSUER)
        .setAudience(RESOURCE)
        .setSubject('alice')
        .setExpirationTime(now + 300)
        .sign(secret);
      await expectRefused(h.verifier, token, 'unsupported-algorithm');
    });

    it('refuses an algorithm the verifier was not configured with', async () => {
      const key = await signer('RS256', 'k1');
      const h = harness(
        standardRoutes(() => [key.jwk]),
        { algorithms: ['ES256'] },
      );
      await expectRefused(h.verifier, await mint(key, h.clock), 'unsupported-algorithm');
    });

    it('refuses when the JWK key type disagrees with the token alg', async () => {
      const rsa = await signer('RS256', 'k1');
      const ec = await signer('ES256', 'k1');
      // The key set publishes an RSA key under the kid an ES256 token names.
      const h = harness(standardRoutes(() => [rsa.jwk]));
      await expectRefused(h.verifier, await mint(ec, h.clock), 'key-mismatch');
    });

    it('refuses when the JWK curve disagrees (P-384 for ES256)', async () => {
      const ec = await signer('ES256', 'k1');
      const { publicKey } = await generateKeyPair('ES384', { extractable: true });
      const p384 = { ...(await exportJWK(publicKey)), kid: 'k1' };
      const h = harness(standardRoutes(() => [p384]));
      await expectRefused(h.verifier, await mint(ec, h.clock), 'key-mismatch');
    });

    it('refuses when the JWK alg or use disagrees', async () => {
      const key = await signer('RS256', 'k1');
      const wrongAlg = harness(standardRoutes(() => [{ ...key.jwk, alg: 'PS256' }]));
      await expectRefused(wrongAlg.verifier, await mint(key, wrongAlg.clock), 'key-mismatch');
      const wrongUse = harness(standardRoutes(() => [{ ...key.jwk, use: 'enc' }]));
      await expectRefused(wrongUse.verifier, await mint(key, wrongUse.clock), 'key-mismatch');
    });

    it('refuses a token without kid when the key set holds more than one key', async () => {
      const a = await signer('ES256', 'a');
      const b = await signer('ES256', 'b');
      const h = harness(standardRoutes(() => [a.jwk, b.jwk]));
      await expectRefused(
        h.verifier,
        await mint(a, h.clock, { header: { kid: undefined } }),
        'ambiguous-key',
      );
    });

    it('refuses a signature made by a different key under a known kid', async () => {
      const published = await signer('ES256', 'k1');
      const forger = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [published.jwk]));
      await expectRefused(h.verifier, await mint(forger, h.clock), 'bad-signature');
    });
  });

  describe('claims', () => {
    it('refuses the wrong issuer', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectRefused(
        h.verifier,
        await mint(key, h.clock, { issuer: 'https://other.example.com' }),
        'wrong-issuer',
      );
    });

    it('applies 60 s of skew to exp', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectAdmitted(h.verifier, await mint(key, h.clock, { expOffset: -59 }));
      await expectRefused(h.verifier, await mint(key, h.clock, { expOffset: -61 }), 'expired');
    });

    it('applies 60 s of skew to nbf', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectAdmitted(h.verifier, await mint(key, h.clock, { nbfOffset: 59 }));
      await expectRefused(h.verifier, await mint(key, h.clock, { nbfOffset: 61 }), 'not-yet-valid');
    });

    it('refuses a token addressed to another resource', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectRefused(
        h.verifier,
        await mint(key, h.clock, { audience: 'https://other.example.com/mcp' }),
        'wrong-audience',
      );
    });

    it('refuses a token missing a required scope', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(standardRoutes(() => [key.jwk]));
      await expectRefused(
        h.verifier,
        await mint(key, h.clock, { claims: { scope: 'agent:read' } }),
        'missing-scope',
      );
    });

    it('refuses a subject and client that are not allowlisted', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness(
        standardRoutes(() => [key.jwk]),
        {
          allowedSubjects: ['bob'],
          allowedClients: ['cli-2'],
        },
      );
      await expectRefused(h.verifier, await mint(key, h.clock), 'principal-not-allowed');
    });
  });

  describe('key discovery', () => {
    it('refuses an http jwks_uri without fetching it', async () => {
      const key = await signer('ES256', 'k1');
      const httpJwks = 'http://auth.example.com/jwks.json';
      const h = harness({
        [METADATA_URL]: () => json({ issuer: ISSUER, jwks_uri: httpJwks }),
        [httpJwks]: () => json({ keys: [key.jwk] }),
      });
      await expectRefused(h.verifier, await mint(key, h.clock), 'keys-unavailable');
      expect(h.calls).not.toContain(httpJwks);
    });

    it('refuses metadata reached by a redirect (to http or anywhere)', async () => {
      const key = await signer('ES256', 'k1');
      const httpMetadata = 'http://auth.example.com/metadata';
      const h = harness({
        [METADATA_URL]: () =>
          new Response(null, { status: 302, headers: { location: httpMetadata } }),
        [httpMetadata]: () => json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => json({ keys: [key.jwk] }),
      });
      await expectRefused(h.verifier, await mint(key, h.clock), 'keys-unavailable');
      expect(h.calls).not.toContain(httpMetadata);
      expect(h.calls).not.toContain(JWKS_URL);
    });

    it('refuses metadata whose issuer differs from the configured one', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness({
        [METADATA_URL]: () => json({ issuer: 'https://evil.example.com', jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => json({ keys: [key.jwk] }),
      });
      await expectRefused(h.verifier, await mint(key, h.clock), 'keys-unavailable');
      expect(h.calls).not.toContain(JWKS_URL);
    });

    it('refuses a key set larger than the byte bound', async () => {
      const key = await signer('ES256', 'k1');
      const h = harness({
        [METADATA_URL]: () => json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => json({ keys: [key.jwk], padding: 'x'.repeat(70 * 1024) }),
      });
      await expectRefused(h.verifier, await mint(key, h.clock), 'keys-unavailable');
    });

    it('refetches for an unknown kid, at a bounded rate', async () => {
      const k1 = await signer('ES256', 'k1');
      const k2 = await signer('ES256', 'k2');
      let published: JWK[] = [k1.jwk];
      const h = harness(standardRoutes(() => published));
      const jwksFetches = () => h.calls.filter((url) => url === JWKS_URL).length;

      await expectAdmitted(h.verifier, await mint(k1, h.clock));
      expect(jwksFetches()).toBe(1);

      // A known kid is served from cache.
      await expectAdmitted(h.verifier, await mint(k1, h.clock));
      expect(jwksFetches()).toBe(1);

      // Inside the interval an unknown kid does not reach the issuer at all.
      h.clock.ms += 1_000;
      await expectRefused(h.verifier, await mint(k2, h.clock), 'unknown-key');
      await expectRefused(h.verifier, await mint(k2, h.clock), 'unknown-key');
      expect(jwksFetches()).toBe(1);

      // After it, one refetch picks up the rotated key.
      h.clock.ms += 30_000;
      published = [k1.jwk, k2.jwk];
      await expectAdmitted(h.verifier, await mint(k2, h.clock));
      expect(jwksFetches()).toBe(2);

      // And an invented kid right after costs no further fetch.
      const k3 = await signer('ES256', 'k3');
      await expectRefused(h.verifier, await mint(k3, h.clock), 'unknown-key');
      expect(jwksFetches()).toBe(2);
      // Metadata was needed once; the jwks_uri is remembered.
      expect(h.calls.filter((url) => url === METADATA_URL)).toHaveLength(1);
    });

    it('fails closed during a key-set outage, and keeps serving cached keys', async () => {
      const k1 = await signer('ES256', 'k1');
      let down = true;
      const h = harness({
        [METADATA_URL]: () => json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => {
          if (down) throw new TypeError('fetch failed');
          return json({ keys: [k1.jwk] });
        },
      });
      await expectRefused(h.verifier, await mint(k1, h.clock), 'keys-unavailable');
      down = false;
      h.clock.ms += 31_000;
      await expectAdmitted(h.verifier, await mint(k1, h.clock));

      down = true;
      h.clock.ms += 31_000;
      const k2 = await signer('ES256', 'k2');
      await expectRefused(h.verifier, await mint(k2, h.clock), 'unknown-key');
      await expectAdmitted(h.verifier, await mint(k1, h.clock));
    });

    it('stops admitting a key the issuer withdrew once the cache reaches its maximum age', async () => {
      const k1 = await signer('ES256', 'k1');
      const k2 = await signer('ES256', 'k2');
      let published: JWK[] = [k1.jwk];
      const h = harness(standardRoutes(() => published));
      await expectAdmitted(h.verifier, await mint(k1, h.clock));

      // The issuer rotates k1 out. Before the maximum age the cache still holds it.
      published = [k2.jwk];
      h.clock.ms += 9 * 60_000;
      await expectAdmitted(h.verifier, await mint(k1, h.clock));

      // At the maximum age the key set — and the metadata — is refetched before verifying.
      h.clock.ms += 60_000;
      await expectRefused(h.verifier, await mint(k1, h.clock), 'unknown-key');
      await expectAdmitted(h.verifier, await mint(k2, h.clock));
      expect(h.calls.filter((url) => url === METADATA_URL)).toHaveLength(2);
    });

    it('admits with cached keys through an outage within the hard age limit', async () => {
      const k1 = await signer('ES256', 'k1');
      let down = false;
      const h = harness({
        [METADATA_URL]: () => json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => {
          if (down) throw new TypeError('fetch failed');
          return json({ keys: [k1.jwk] });
        },
      });
      await expectAdmitted(h.verifier, await mint(k1, h.clock));
      down = true;
      h.clock.ms += 59 * 60_000;
      await expectAdmitted(h.verifier, await mint(k1, h.clock));
    });

    it('refuses once an outage outlasts the hard age limit, and recovers after it', async () => {
      const k1 = await signer('ES256', 'k1');
      let down = false;
      const h = harness({
        [METADATA_URL]: () => json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => {
          if (down) return new Response('down', { status: 503 });
          return json({ keys: [k1.jwk] });
        },
      });
      await expectAdmitted(h.verifier, await mint(k1, h.clock));
      down = true;
      h.clock.ms += 60 * 60_000;
      await expectRefused(h.verifier, await mint(k1, h.clock), 'keys-unavailable');
      // Still refused inside the retry interval: the dropped keys do not come back on their own.
      h.clock.ms += 1_000;
      await expectRefused(h.verifier, await mint(k1, h.clock), 'keys-unavailable');

      down = false;
      h.clock.ms += 30_000;
      await expectAdmitted(h.verifier, await mint(k1, h.clock));
    });

    it('checks the key whose kid AND shape fit when two keys share a kid', async () => {
      const rsa = await signer('RS256', 'shared');
      const ec = await signer('ES256', 'shared');
      const h = harness(standardRoutes(() => [rsa.jwk, ec.jwk]));
      await expectAdmitted(h.verifier, await mint(ec, h.clock));
      await expectAdmitted(h.verifier, await mint(rsa, h.clock));
    });

    it('treats a non-200 key-set response as an outage', async () => {
      const k1 = await signer('ES256', 'k1');
      const h = harness({
        [METADATA_URL]: () => json({ issuer: ISSUER, jwks_uri: JWKS_URL }),
        [JWKS_URL]: () => new Response('down', { status: 503 }),
      });
      await expectRefused(h.verifier, await mint(k1, h.clock), 'keys-unavailable');
    });

    it('reaches a private issuer host, and no other private host', async () => {
      const key = await signer('ES256', 'k1');
      const issuer = 'https://auth.internal';
      const internalMetadata = `${issuer}/.well-known/oauth-authorization-server`;
      const addresses = { 'auth.internal': '10.0.0.5', 'keys.internal': '10.0.0.6' };

      const sameHost = harness(
        {
          [internalMetadata]: () => json({ issuer, jwks_uri: `${issuer}/jwks` }),
          [`${issuer}/jwks`]: () => json({ keys: [key.jwk] }),
        },
        { issuer },
        addresses,
      );
      await expectAdmitted(sameHost.verifier, await mint(key, sameHost.clock, { issuer }));

      const otherHost = harness(
        {
          [internalMetadata]: () => json({ issuer, jwks_uri: 'https://keys.internal/jwks' }),
          'https://keys.internal/jwks': () => json({ keys: [key.jwk] }),
        },
        { issuer },
        addresses,
      );
      await expectRefused(
        otherHost.verifier,
        await mint(key, otherHost.clock, { issuer }),
        'keys-unavailable',
      );
      expect(otherHost.calls).not.toContain('https://keys.internal/jwks');
      expect(otherHost.lookups).toContain('keys.internal');
    });
  });

  it('never puts token text, a claim value or an error message in a refusal', async () => {
    const key = await signer('ES256', 'k1');
    const forger = await signer('ES256', 'k1');
    const h = harness(
      standardRoutes(() => [key.jwk]),
      { allowedSubjects: ['bob'] },
    );
    const down = harness({});
    const cases: Array<[IAccessTokenVerifier, string]> = [
      [h.verifier, await mint(key, h.clock, { header: { typ: 'JWT' } })],
      [h.verifier, await mint(key, h.clock, { issuer: 'https://other.example.com' })],
      [h.verifier, await mint(key, h.clock, { audience: 'https://other.example.com/mcp' })],
      [h.verifier, await mint(key, h.clock, { claims: { scope: 'agent:read' } })],
      [h.verifier, await mint(key, h.clock, { expOffset: -3600 })],
      [h.verifier, await mint(key, h.clock)],
      [h.verifier, await mint(forger, h.clock)],
      [h.verifier, `${await mint(key, h.clock)}${'x'.repeat(9000)}`],
      [h.verifier, 'garbage.alice.cli-1'],
      [down.verifier, await mint(key, down.clock)],
    ];
    const refusals = new Set<string>();
    for (const [verifier, token] of cases) {
      const result: TAccessTokenAdmission = await verifier.verify(token);
      expect(result.admitted).toBe(false);
      expect(Object.keys(result).sort()).toEqual(['admitted', 'refusal']);
      if (!result.admitted) refusals.add(result.refusal);
      const serialized = JSON.stringify(result);
      for (const segment of token.split('.').filter((part) => part.length > 8)) {
        expect(serialized).not.toContain(segment);
      }
      expect(serialized).not.toContain('alice');
      expect(serialized).not.toContain('cli-1');
      expect(serialized).not.toContain('example.com');
    }
    // Every case reached a different refusal, so the check above covered each reason's path.
    expect(refusals.size).toBe(cases.length);
  });
});
