/**
 * CORE-043 decision (1): the advertised gateway configuration must not report enforcement it has not
 * got.
 *
 * `llms.txt` and `types.ts` advertise `baseURL` for OpenAI-compatible gateways. Setting it also
 * switches the API surface to `chat-completions` (`resolveApiSurface`), so it is precisely the
 * configuration where whatever is on the far end is least likely to honour a structured-output
 * parameter — and the runtime claimed early enforcement on it anyway.
 *
 * This provider declares no capability table by choice; nobody has verified one, and inventing one
 * would be a fabricated claim. It can still answer this question, which is why the endpoint signal is
 * a separate member rather than a field on the table.
 */

import { describe, expect, it } from 'vitest';

import { OpenAIProvider } from '../provider';

import type { IAIProvider } from '@robota-sdk/agent-core';

describe('CORE-043 — OpenAI endpoint provenance', () => {
  it('reports the vendor endpoint when no baseURL is configured', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    expect(provider.endpointIsVendorDefault()).toBe(true);
  });

  it('reports a gateway when baseURL is configured', () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key', baseURL: 'https://gateway.test/v1' });
    expect(provider.endpointIsVendorDefault()).toBe(false);
  });

  it('still declares no capability table, so the signal cannot depend on one', () => {
    // If the endpoint signal had been a field on the table, this provider could only report its
    // endpoint by first inventing capability claims nobody verified. Read through `IAIProvider`
    // rather than the class: `capabilityTable` is optional on the contract, and the point is that
    // this provider leaves it unimplemented while still answering the endpoint question.
    const provider: IAIProvider = new OpenAIProvider({
      apiKey: 'test-key',
      baseURL: 'https://gateway.test/v1',
    });
    expect(provider.capabilityTable).toBeUndefined();
    expect(provider.endpointIsVendorDefault?.()).toBe(false);
  });
});
