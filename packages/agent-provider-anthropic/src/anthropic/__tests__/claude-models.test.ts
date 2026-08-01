import { describe, expect, it, vi } from 'vitest';

import { CLAUDE_MODELS } from '../claude-models.js';

/**
 * NEUT-010 — the Claude table, and the cases that came with it from `agent-core`.
 *
 * `agent-core`'s own SPEC says it must not branch on concrete provider or model names, yet it
 * carried this table and this package imported it back out. Two consequences: the vendor-neutral
 * foundation held one vendor's catalogue, and every model NOT in that table silently received
 * Claude's 200 000-token window.
 *
 * The registration tests are DECISIVE, which took two attempts to get right:
 *
 * 1. The first version cleared the registry and asserted the model was findable. It PASSED with the
 *    registration deleted, because `findModelDefinition` also consulted core's built-in table — an
 *    accidental green in the test written to prove a seam is load-bearing.
 * 2. The second re-imported a cached module after clearing. A module-load side effect fires ONCE, so
 *    that proves nothing either.
 *
 * What works is a FRESH module graph per case: `vi.resetModules()` gives a core whose registry is
 * empty, and every import in that generation resolves to the same instance. Sonnet is the probe
 * because its real window (1 000 000) differs from the default (200 000) — Haiku's happens to equal
 * the default, so it could not tell the two apart.
 */
describe('CLAUDE_MODELS (moved here from agent-core)', () => {
  it('contains known model IDs', () => {
    expect(CLAUDE_MODELS['claude-opus-4-6']).toBeDefined();
    expect(CLAUDE_MODELS['claude-sonnet-4-6']).toBeDefined();
    expect(CLAUDE_MODELS['claude-haiku-4-5']).toBeDefined();
  });

  it('each entry has required fields, and its key matches its id', () => {
    for (const [id, model] of Object.entries(CLAUDE_MODELS)) {
      expect(model.id).toBe(id);
      expect(model.name).toBeTruthy();
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutput).toBeGreaterThan(0);
    }
  });
});

describe('registration with the core registry (NEUT-010)', () => {
  it('core alone knows nothing about Claude — the neutral package carries no vendor table', async () => {
    vi.resetModules();
    const core = await import('@robota-sdk/agent-core');
    // If this ever starts returning the real window, the table has crept back into the neutral
    // package and every assertion below stops meaning anything.
    expect(core.getModelContextWindow('claude-sonnet-4-6')).toBe(core.DEFAULT_CONTEXT_WINDOW);
    expect(core.getModelName('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('importing this table registers it', async () => {
    vi.resetModules();
    await import('../claude-models.js');
    const core = await import('@robota-sdk/agent-core');
    expect(core.getModelContextWindow('claude-sonnet-4-6')).toBe(1_000_000);
    expect(core.getModelName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
  });

  /**
   * `provider.ts` asks for `max_tokens` and the answer comes from the core registry, so the models
   * must be registered wherever the provider is reachable. The first shape imported the table only
   * from the definition module, and the provider's own test caught it: Sonnet received the 16 384
   * default instead of its 64 000. The fix routes the question through the owner
   * (`resolveAnthropicMaxTokens`), so asking it necessarily brings the answers.
   */
  it('is reachable from the provider module itself, not only from the definition module', async () => {
    vi.resetModules();
    await import('../provider.js');
    const core = await import('@robota-sdk/agent-core');
    expect(core.getModelMaxOutput('claude-sonnet-4-6')).toBe(64_000);
  });
});
