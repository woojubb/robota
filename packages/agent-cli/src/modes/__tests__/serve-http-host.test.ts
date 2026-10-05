import { createServer, request } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startServeHttpHost,
  type IServeHttpHost,
  type IServeHttpRefusal,
} from '../serve-http-host.js';


const PUBLIC_HOST = 'agents.example.test';
const refusals: IServeHttpRefusal[] = [];
let sessionReached = 0;
let host: IServeHttpHost;
let port = 0;

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** Shaped like an access token (header the verifier accepts), signed by nobody. */
const SHAPED_TOKEN = [
  base64url({ alg: 'ES256', typ: 'at+jwt', kid: 'k1' }),
  base64url({ sub: 'client-a', client_id: 'c', exp: Math.floor(Date.now() / 1000) + 300 }),
  'c2lnbmF0dXJl',
].join('.');

function call(path: string, token?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: {
          host: PUBLIC_HOST,
          ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    )
      .on('error', reject)
      .end();
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

beforeAll(async () => {
  host = await startServeHttpHost({
    port: await freePort(),
    remote: {
      host: '127.0.0.1',
      publicUrl: `https://${PUBLIC_HOST}/agent`,
      // Nothing listens on port 1: the issuer's keys can never be fetched.
      issuer: 'https://127.0.0.1:1',
      scopes: ['agent.run'],
      allowedSubjects: ['client-a'],
      trustedProxies: [],
    },
    session: () => {
      sessionReached += 1;
      throw new Error('the session must not be reached');
    },
    onRefusal: (record) => refusals.push(record),
  });
  port = Number(host.listening.split(':').pop());
});

afterAll(async () => {
  await host?.stop();
});

describe('startServeHttpHost as an OAuth resource server', () => {
  it('answers 404 for a path outside the base before any token check', async () => {
    for (const path of ['/agentX/submit', '/agent', '/agent%2F..', '/submit']) {
      expect(await call(path), path).toBe(404);
      expect(await call(path, SHAPED_TOKEN), path).toBe(404);
    }
    expect(refusals).toEqual([]);
    expect(sessionReached).toBe(0);
  });

  it('challenges a request under the base without a token', async () => {
    expect(await call('/agent/')).toBe(401);
    expect(refusals.at(-1)).toEqual({
      refusal: 'missing-token',
      remote: 'loopback',
      throttled: false,
    });
  });

  it('answers 503 when the issuer is unreachable, without counting it against the peer', async () => {
    refusals.length = 0;
    // More than the per-address failure budget: none of them may turn into 429.
    for (let index = 0; index < 25; index += 1) {
      expect(await call('/agent/executing', SHAPED_TOKEN)).toBe(503);
    }
    expect(refusals).toHaveLength(25);
    expect(refusals.every((record) => record.refusal === 'keys-unavailable')).toBe(true);
    expect(refusals.every((record) => !record.throttled)).toBe(true);
    // Had those been counted, this peer would now be throttled.
    expect(await call('/agent/executing')).toBe(401);
    expect(sessionReached).toBe(0);
  }, 60_000);
});
