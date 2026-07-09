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
});
