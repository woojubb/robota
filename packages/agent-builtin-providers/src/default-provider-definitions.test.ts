import { describe, expect, it } from 'vitest';

import { createDefaultProviderDefinitions } from './default-provider-definitions.js';

/**
 * Keep the original provider order when adding a service, and retain each provider's factory.
 * ByteDance is a media/video provider and remains outside the chat provider set.
 */
describe('createDefaultProviderDefinitions (ARCH-PROVIDER-002 golden)', () => {
  it('appends OpenRouter while preserving the original chat provider order', () => {
    const types = createDefaultProviderDefinitions().map((d) => d.type);
    expect(types).toEqual([
      'anthropic',
      'openai',
      'gemini',
      'gemma',
      'qwen',
      'deepseek',
      'openrouter',
    ]);
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

  it('declares native web search exactly where a profile can switch it on', () => {
    // A host reads `nativeWebTools` to decide where it may set the profile option; a declaration the
    // provider does not honour, or an honoured option it does not declare, would let them drift.
    for (const definition of createDefaultProviderDefinitions()) {
      const profiles = [
        {
          ...(definition.defaults?.baseURL !== undefined && {
            baseURL: definition.defaults.baseURL,
          }),
        },
        { baseURL: 'http://localhost:1234/v1' },
        { options: { apiSurface: 'chat-completions' } },
      ];
      for (const profile of profiles) {
        const build = () =>
          definition.createProvider({
            name: definition.type,
            model: definition.defaults?.model ?? 'test-model',
            apiKey: 'test-key',
            ...profile,
            options: { ...profile.options, nativeWebTools: { webSearch: true } },
          });
        const label = `${definition.type} ${JSON.stringify(profile)}`;
        if (definition.nativeWebTools?.(profile, {}).includes('webSearch') === true) {
          expect(build().getCapabilities?.().nativeWebTools.webSearch.enabled, label).toBe(true);
        } else {
          let enabled = false;
          try {
            enabled = build().getCapabilities?.().nativeWebTools.webSearch.enabled === true;
          } catch {
            enabled = false;
          }
          expect(enabled, label).toBe(false);
        }
      }
    }
    expect(
      createDefaultProviderDefinitions()
        .filter((d) => d.nativeWebTools?.({}, {}).includes('webSearch') === true)
        .map((d) => d.type),
    ).toEqual(['anthropic', 'openai', 'gemini']);
  });

  it('declares, for every built-in provider, the environment its client reads to pick a destination', () => {
    // A child process builds the provider from the parent's configuration; only a declared variable
    // is compared before the parent's credential is handed over. An undeclared one is a gap.
    for (const definition of createDefaultProviderDefinitions()) {
      expect(definition.destinationEnvironment, definition.type).toBeDefined();
    }
    const byType = Object.fromEntries(
      createDefaultProviderDefinitions().map((d) => [d.type, d.destinationEnvironment]),
    );
    expect(byType.anthropic).toContain('ANTHROPIC_BASE_URL');
    expect(byType.openai).toContain('OPENAI_BASE_URL');
    expect(byType.gemini).toContain('GOOGLE_GENAI_USE_VERTEXAI');
  });
});
