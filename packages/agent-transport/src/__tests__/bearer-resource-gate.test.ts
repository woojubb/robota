import { describe, expect, it } from 'vitest';

import {
  createBearerResourceServer,
  describeProtectedResource,
} from '../node/bearer-resource-gate.js';

import type { IncomingMessage, ServerResponse } from 'node:http';

function request(headers: Record<string, string>, remoteAddress = '127.0.0.1'): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

function response() {
  const written: { status?: number; headers?: Record<string, string> } = {};
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      written.status = status;
      if (headers !== undefined) written.headers = headers;
      return { end: () => undefined };
    },
  } as unknown as ServerResponse;
  return { res, written };
}

describe('shared bearer resource-server gate', () => {
  it('places the RFC 9728 metadata before the resource path and points every challenge at it', () => {
    const resource = describeProtectedResource({
      resource: 'https://robota.example/hooks/events/ci',
      issuer: 'https://auth.example',
      scopes: ['a', 'b'],
      label: 'Test',
    });
    expect(resource.wellKnownPath).toBe('/.well-known/oauth-protected-resource/hooks/events/ci');
    const metadata = 'https://robota.example/.well-known/oauth-protected-resource/hooks/events/ci';
    expect(resource.challenges).toEqual({
      missing: `Bearer resource_metadata="${metadata}"`,
      invalid: `Bearer error="invalid_token", resource_metadata="${metadata}"`,
      scope: `Bearer error="insufficient_scope", scope="a b", resource_metadata="${metadata}"`,
    });
  });

  it('believes X-Forwarded-For only from a trusted proxy, and only its rightmost untrusted hop', () => {
    const server = createBearerResourceServer({
      publicUrl: 'https://robota.example',
      trustedProxies: ['127.0.0.1', '10.0.0.2'],
      label: 'Test',
    });
    const budgetAfter = (count: number, req: IncomingMessage) => {
      let last = server.fail(req);
      for (let index = 1; index < count; index += 1) last = server.fail(req);
      return last;
    };
    // From an untrusted peer the header is ignored: the peer itself is counted and classed.
    const untrusted = request({ 'x-forwarded-for': '198.51.100.9' }, '203.0.113.5');
    expect(server.remote(untrusted)).toBe('public');
    expect(budgetAfter(21, untrusted).throttled).toBe(true);
    expect(server.fail(request({}, '198.51.100.9')).throttled).toBe(false);
    // From a trusted proxy: the nearest untrusted hop, skipping further trusted proxies.
    const viaProxies = request({ 'x-forwarded-for': '6.6.6.6, 198.51.100.20, 10.0.0.2' });
    expect(budgetAfter(21, viaProxies).throttled).toBe(true);
    // A forged hop further left does not move the counted address.
    const forged = request({ 'x-forwarded-for': '1.1.1.1, 198.51.100.20' });
    expect(server.fail(forged).throttled).toBe(true);
    // A garbage hop falls back to the proxy itself.
    expect(server.remote(request({ 'x-forwarded-for': 'not-an-ip' }))).toBe('loopback');
    // A different client behind the proxy has its own budget.
    expect(server.fail(request({ 'x-forwarded-for': '198.51.100.21' })).throttled).toBe(false);
  });

  it('refuses an unsafe configuration, naming the carrier', () => {
    const base = {
      resource: 'https://r.example/x',
      issuer: 'https://i.example',
      scopes: ['s'],
      label: 'Carrier',
    };
    expect(() => describeProtectedResource({ ...base, resource: 'http://r.example/x' })).toThrow(
      /^Carrier public URL must use https/,
    );
    expect(() => describeProtectedResource({ ...base, issuer: 'http://i.example' })).toThrow(
      /^Carrier authorization issuer/,
    );
    expect(() => describeProtectedResource({ ...base, scopes: ['a b'] })).toThrow(/valid scope/);
    expect(() =>
      createBearerResourceServer({
        publicUrl: 'https://r.example',
        trustedProxies: ['proxy'],
        label: 'Carrier',
      }),
    ).toThrow(/^Carrier trusted proxy must be a literal IP address/);
  });

  it('checks Host and Origin against the public URL and counts only the failures it is told of', () => {
    let clock = 0;
    const server = createBearerResourceServer({
      publicUrl: 'https://robota.example/hooks',
      label: 'Test',
      now: () => clock,
    });
    const ok = response();
    expect(server.checkNames(request({ host: 'robota.example' }), ok.res)).toBe(true);
    expect(
      server.checkNames(
        request({ host: 'robota.example:443', origin: 'https://robota.example' }),
        ok.res,
      ),
    ).toBe(true);
    const bad = response();
    expect(server.checkNames(request({ host: '127.0.0.1' }), bad.res)).toBe(false);
    expect(bad.written.status).toBe(403);
    const peer = request({ host: 'robota.example' }, '203.0.113.9');
    let last = server.fail(peer);
    for (let index = 1; index < 21; index += 1) last = server.fail(peer);
    expect(last).toMatchObject({ remote: 'public', throttled: true });
    expect(server.remote(request({}, '10.0.0.4'))).toBe('private');
    clock = 60_000;
    expect(server.fail(peer).throttled).toBe(false);
  });
});
