import { describe, expect, it } from 'vitest';

import { createDefaultProviderDefinitions } from './default-provider-definitions.js';

/**
 * ARCH-PROVIDER-002 Stage A golden characterization: the provider split must preserve the exact set
 * (and order) of default provider definitions the removed `agent-provider` monolith aggregated, and
 * each must still expose a `createProvider` factory. bytedance is a media/video provider and is
 * intentionally NOT in the LLM default set.
 */
describe('createDefaultProviderDefinitions (ARCH-PROVIDER-002 golden)', () => {
  it('aggregates the 6 LLM provider definitions in the original order', () => {
    const types = createDefaultProviderDefinitions().map((d) => d.type);
    expect(types).toEqual(['anthropic', 'openai', 'gemini', 'gemma', 'qwen', 'deepseek']);
  });

  it('every definition exposes a createProvider factory', () => {
    for (const definition of createDefaultProviderDefinitions()) {
      expect(typeof definition.createProvider).toBe('function');
    }
  });

  it('carries the interim per-provider cost migrated from the former llm-text vendor nodes (ARCH-PROVIDER-003 TC-05)', () => {
    const costByType = Object.fromEntries(
      createDefaultProviderDefinitions().map((d) => [d.type, d.costPerTokenUsd]),
    );
    // Migrated verbatim from each deleted llm-text-<vendor> node's COST_PER_TOKEN_USD scalar.
    expect(costByType.anthropic).toBe(0.003);
    expect(costByType.openai).toBe(0.001);
    expect(costByType.gemini).toBe(0.0005);
    expect(costByType.deepseek).toBe(0.0001);
    expect(costByType.qwen).toBe(0.0002);
  });
});
