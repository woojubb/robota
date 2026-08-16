/**
 * CORE-043: Anthropic's capability declaration and where it is actually pointed are separate answers.
 *
 * The table describes the vendor's models. `baseURL` describes the endpoint serving them. A gateway
 * still speaks Anthropic's protocol, so the table remains the right description of the request — what
 * changes is that nothing here can claim the far end enforces the schema it is handed.
 */

import { describe, expect, it } from 'vitest';

import { ANTHROPIC_CAPABILITY_TABLE } from '../capability-table';
import { AnthropicProvider } from '../provider';

describe('CORE-043 — Anthropic endpoint provenance', () => {
  it('reports the vendor endpoint when no baseURL is configured', () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    expect(provider.endpointIsVendorDefault()).toBe(true);
  });

  it('reports a gateway when baseURL is configured', () => {
    const provider = new AnthropicProvider({
      apiKey: 'test-key',
      baseURL: 'https://gateway.test/v1',
    });
    expect(provider.endpointIsVendorDefault()).toBe(false);
  });

  it('does not change the capability table itself behind a gateway', () => {
    // The regression this guards: folding the endpoint into the table would make a gateway look like
    // a model that lost a capability, which is a different claim and a wrong one.
    const provider = new AnthropicProvider({
      apiKey: 'test-key',
      baseURL: 'https://gateway.test/v1',
    });
    expect(provider.capabilityTable()).toBe(ANTHROPIC_CAPABILITY_TABLE);
  });
});
