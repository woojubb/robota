import { describe, expect, it, vi } from 'vitest';

import {
  fetchWithEgressPolicy,
  isPrivateAddress,
  rejectDestination,
  type TEgressLookup,
} from './egress-policy.js';

/** A resolver over a fixed table; anything else is "public". */
function tableLookup(table: Record<string, string[]>): TEgressLookup {
  return async (hostname) => table[hostname] ?? ['93.184.216.34'];
}

function textResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, { status: init.status ?? 200, headers: init.headers });
}

describe('isPrivateAddress (#2026)', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'ff02::1',
    '::ffff:7f00:1', // IPv4-mapped 127.0.0.1 as URL normalizes it
    '::ffff:c0a8:101', // IPv4-mapped 192.168.1.1
    '64:ff9b::a9fe:a9fe', // NAT64-embedded 169.254.169.254
  ])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])(
    '%s is public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('rejectDestination (#2026)', () => {
  const lookup = tableLookup({
    'intranet.corp': ['10.1.2.3'],
    'rebind.example': ['1.2.3.4', '127.0.0.1'],
  });

  it.each([
    'http://localhost/',
    'http://app.localhost/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433/', // decimal 127.0.0.1 — URL normalizes it
    'http://0x7f.1/', // hex-dotted 127.0.0.1
    'http://[::ffff:127.0.0.1]/',
    'http://[::1]/',
    'http://intranet.corp/',
    'http://rebind.example/', // one public and one private answer: refused
    'ftp://example.com/',
    'file:///etc/passwd',
  ])('refuses %s', async (url) => {
    const rejection = await rejectDestination(new URL(url), {}, lookup);
    expect(rejection).toBeDefined();
  });

  it('allows a public destination, an allowlisted host, and the explicit private opt-out', async () => {
    expect(await rejectDestination(new URL('https://example.com/'), {}, lookup)).toBeUndefined();
    expect(
      await rejectDestination(
        new URL('http://intranet.corp/'),
        { allowedHosts: ['intranet.corp'] },
        lookup,
      ),
    ).toBeUndefined();
    expect(
      await rejectDestination(
        new URL('http://127.0.0.1:8080/'),
        { allowPrivateAddresses: true },
        lookup,
      ),
    ).toBeUndefined();
  });

  it('reports an unresolvable host as a policy outcome', async () => {
    const failing: TEgressLookup = async () => {
      throw new Error('ENOTFOUND');
    };
    expect((await rejectDestination(new URL('https://nope.invalid/'), {}, failing))?.reason).toBe(
      'unresolvable',
    );
  });
});

describe('fetchWithEgressPolicy (#2026)', () => {
  const lookup = tableLookup({ 'intranet.corp': ['10.1.2.3'] });

  it('re-validates every redirect hop and refuses a public-to-private redirect', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        textResponse('', { status: 302, headers: { location: 'http://intranet.corp/x' } }),
      );
    const result = await fetchWithEgressPolicy('https://example.com/', {}, {}, { fetch, lookup });
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'private_destination' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('drops caller and credential headers on a cross-origin redirect, keeps them same-origin', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(textResponse('', { status: 301, headers: { location: '/moved' } }))
      .mockResolvedValueOnce(
        textResponse('', { status: 307, headers: { location: 'https://other.example/' } }),
      )
      .mockResolvedValueOnce(textResponse('done'));
    const headers = {
      Authorization: 'Bearer secret',
      Cookie: 'a=b',
      'X-Custom': '1',
      'User-Agent': 'ua',
    };
    const result = await fetchWithEgressPolicy(
      'https://example.com/',
      { headers },
      {},
      { fetch, lookup },
    );
    expect(result.ok).toBe(true);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ headers }); // same origin: intact
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ headers: { 'User-Agent': 'ua' } });
    expect(JSON.stringify(fetch.mock.calls[2]?.[1])).not.toContain('secret');
  });

  it('refuses more redirects than the policy allows', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(textResponse('', { status: 302, headers: { location: '/again' } }));
    const result = await fetchWithEgressPolicy(
      'https://example.com/',
      {},
      { maxRedirects: 2 },
      { fetch, lookup },
    );
    expect(result).toMatchObject({ ok: false, rejection: { reason: 'redirect_limit' } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('caps the body from Content-Length before reading, and while streaming without it', async () => {
    const declared = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(textResponse('x', { headers: { 'content-length': '999' } }));
    const early = await fetchWithEgressPolicy(
      'https://example.com/',
      { maxResponseBytes: 10 },
      {},
      { fetch: declared, lookup },
    );
    expect(early).toMatchObject({ ok: false, rejection: { reason: 'response_too_large' } });

    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4));
      },
    });
    const streaming = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(endless, { status: 200 }));
    const late = await fetchWithEgressPolicy(
      'https://example.com/',
      { maxResponseBytes: 10 },
      {},
      { fetch: streaming, lookup },
    );
    expect(late).toMatchObject({ ok: false, rejection: { reason: 'response_too_large' } });
    expect(pulled).toBeLessThan(10); // stopped at the cap, not after allocating the whole stream
  });

  it('composes the caller signal with the deadline and returns the final body and URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(textResponse('hello'));
    const caller = new AbortController();
    const result = await fetchWithEgressPolicy(
      'https://example.com/a',
      { signal: caller.signal, timeoutMs: 5_000 },
      {},
      { fetch, lookup },
    );
    expect(result).toMatchObject({ ok: true, status: 200, finalUrl: 'https://example.com/a' });
    if (result.ok) expect(new TextDecoder().decode(result.body)).toBe('hello');
    const passed = fetch.mock.calls[0]?.[1]?.signal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed).not.toBe(caller.signal); // composed, not passed through
  });
});
