import { modelDeclaresCapability } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { DEEPSEEK_CAPABILITY_TABLE } from '../capability-table';
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

  it('surfaces its capability table, so the per-model answer is reachable at call time', () => {
    // The claims existed before — in the model catalog on `provider-definition.ts`, which the
    // running provider never holds. Written down somewhere nothing reads is how the two drifted.
    expect(provider.capabilityTable()).toBe(DEEPSEEK_CAPABILITY_TABLE);
  });

  it('the vendor supports function calling — and deepseek-reasoner does not', () => {
    expect(provider.supportsTools()).toBe(true);
    expect(modelDeclaresCapability(provider.capabilityTable(), 'deepseek-reasoner', 'tools')).toBe(
      false,
    );
  });

  it('deepseek-chat does, so the distinction is per-model rather than a blanket denial', () => {
    expect(modelDeclaresCapability(provider.capabilityTable(), 'deepseek-chat', 'tools')).toBe(
      true,
    );
  });

  it('PROV-008 — a model nobody listed gets the vendor default, not a denial', () => {
    // The rule that makes a deviation list safe. Before this, a model absent from the catalog was
    // indistinguishable from one that declares nothing, so the whole table had to enumerate.
    expect(
      modelDeclaresCapability(provider.capabilityTable(), 'deepseek-v9-unreleased', 'tools'),
    ).toBe(true);
  });

  it('the reasoning model still declares what it CAN do', () => {
    // A model that lists nothing would be indistinguishable from one the catalog is silent about,
    // and silence is not denial — so the entry has to be populated for the omission to mean anything.
    const table = provider.capabilityTable();
    expect(modelDeclaresCapability(table, 'deepseek-reasoner', 'reasoning')).toBe(true);
    // CORE-043: `json_object`, not `json_schema`. DeepSeek guarantees the response PARSES; it takes
    // no schema parameter and enforces no shape, and the old claim is why a structured turn sent an
    // option the endpoint ignored.
    expect(modelDeclaresCapability(table, 'deepseek-reasoner', 'json_object')).toBe(true);
    expect(modelDeclaresCapability(table, 'deepseek-reasoner', 'json_schema')).toBe(false);
    expect(modelDeclaresCapability(table, 'deepseek-reasoner', 'streaming')).toBe(true);
  });
});
