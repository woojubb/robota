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

/**
 * CLI-1990 TC-15 — Anthropic is the one table in the tree that declares `tool_search`.
 *
 * The declaration is a claim about the VENDOR, not a switch: v1 emits no `tool_search_tool_*` block
 * and no per-tool `defer_loading`, because that feature keeps definitions out of the context window
 * while the request still carries every one of them — which is not what this repo's deferral does.
 * Gemini documents no equivalent, and the OpenAI provider publishes no capability table at all, so
 * neither can carry the flag; declaring it here is what lets a later offload be gated on the table
 * rather than on a provider name.
 */
describe('CLI-1990 TC-15 — the tool_search declaration', () => {
  it('declares tool_search in the vendor default', () => {
    expect(ANTHROPIC_CAPABILITY_TABLE.vendorDefault).toContain('tool_search');
  });

  it('keeps every capability it declared before — the member is additive', () => {
    expect(ANTHROPIC_CAPABILITY_TABLE.vendorDefault).toEqual([
      'tools',
      'vision',
      'json_schema',
      'reasoning',
      'streaming',
      'tool_search',
    ]);
  });

  it('adds no per-model deviation for it — the declaration is the whole change', () => {
    // The vendor default applies to every model; nothing here claims a model differs.
    expect(ANTHROPIC_CAPABILITY_TABLE.deviations).toBeUndefined();
  });
});
