import { modelDeclaresCapability } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { DEEPSEEK_MODEL_CATALOG } from '../model-catalog';
import { DeepSeekProvider } from '../provider';

/**
 * PROV-006 — the self-contradiction this provider carried.
 *
 * `supportsTools()` returned an unconditional `true` while this package's own model catalog said
 * `deepseek-reasoner` has no `tools`. Two answers to the same question, and the only one anything
 * read was the wrong one — so a reasoning model was offered the whole toolset.
 *
 * They are no longer two answers to one question. The boolean answers for the VENDOR, which is the
 * only thing a provider-granular flag can honestly say; the catalog answers for the MODEL, and the
 * execution seam asks it before offering tools.
 */

describe('PROV-006 — deepseek stops contradicting its own catalog', () => {
  const provider = new DeepSeekProvider({ apiKey: 'test-key-not-used' });

  it('surfaces its catalog, so the per-model answer is reachable at call time', () => {
    // It existed before this change too — in `provider-definition.ts`, where the running provider
    // could not reach it. Being written down somewhere nothing reads is how the two drifted.
    expect(provider.modelCatalog()).toBe(DEEPSEEK_MODEL_CATALOG);
  });

  it('the vendor supports function calling — and deepseek-reasoner does not', () => {
    expect(provider.supportsTools()).toBe(true);
    expect(modelDeclaresCapability(provider.modelCatalog(), 'deepseek-reasoner', 'tools')).toBe(
      false,
    );
  });

  it('deepseek-chat does, so the distinction is per-model rather than a blanket denial', () => {
    expect(modelDeclaresCapability(provider.modelCatalog(), 'deepseek-chat', 'tools')).toBe(true);
  });

  it('the reasoning model still declares what it CAN do', () => {
    // A model that lists nothing would be indistinguishable from one the catalog is silent about,
    // and silence is not denial — so the entry has to be populated for the omission to mean anything.
    const catalog = provider.modelCatalog();
    expect(modelDeclaresCapability(catalog, 'deepseek-reasoner', 'reasoning')).toBe(true);
    expect(modelDeclaresCapability(catalog, 'deepseek-reasoner', 'json_schema')).toBe(true);
    expect(modelDeclaresCapability(catalog, 'deepseek-reasoner', 'streaming')).toBe(true);
  });
});
