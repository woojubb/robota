import { describe, expect, it, vi } from 'vitest';

import { admitHttpEndpoint } from '../client/transport.js';

import type { TEgressLookup } from '@robota-sdk/agent-core/node';

/**
 * TC-05: admission happens BEFORE any connection attempt. The load-bearing assertion in every case
 * is not just that `admit` returns a refusal, but that the `fetch` the caller supplied is never
 * invoked — nothing here decides by trying to connect and failing.
 */
function neverCalledFetch(): typeof globalThis.fetch {
  return vi.fn(async () => {
    throw new Error('fetch must never be called for a refused destination');
  }) as unknown as typeof globalThis.fetch;
}

describe('admitHttpEndpoint — URL admission (TC-05)', () => {
  it('refuses an http:// URL to a non-loopback host that resolves privately, before connecting', async () => {
    const lookup: TEgressLookup = async () => ['10.0.0.5'];
    const fetchStub = neverCalledFetch();

    const admission = await admitHttpEndpoint(
      { url: 'http://internal.example.com/mcp' },
      { lookup, fetch: fetchStub },
    );

    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.reason).toMatch(/^egress-policy:/);
      expect(admission.reason).toContain('private_destination');
      expect(admission.message.length).toBeGreaterThan(0);
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a hostname that resolves to a private-range address, naming the policy reason', async () => {
    const lookup: TEgressLookup = async () => ['10.0.0.5'];
    const fetchStub = neverCalledFetch();

    const admission = await admitHttpEndpoint(
      { url: 'https://backend.example.com/mcp' },
      { lookup, fetch: fetchStub },
    );

    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.reason).toBe('egress-policy:private_destination');
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('refuses a hostname that resolves to the cloud metadata address 169.254.169.254', async () => {
    const lookup: TEgressLookup = async () => ['169.254.169.254'];
    const fetchStub = neverCalledFetch();

    const admission = await admitHttpEndpoint(
      { url: 'https://metadata.example.com/mcp' },
      { lookup, fetch: fetchStub },
    );

    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.reason).toBe('egress-policy:private_destination');
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('never calls the lookup or fetch for a syntactically invalid URL', async () => {
    const lookup = vi.fn<TEgressLookup>(async () => ['203.0.113.9']);
    const fetchStub = neverCalledFetch();

    const admission = await admitHttpEndpoint({ url: 'not a url' }, { lookup, fetch: fetchStub });

    expect(admission.ok).toBe(false);
    if (!admission.ok) {
      expect(admission.reason).toBe('invalid-url');
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
