import { createGemmaProviderDefinition } from '@robota-sdk/agent-provider-openai-compatible';

import { providerUrl, type TFixtureProduct } from './product.js';

/** A public OpenAI-compatible adapter pointed only at the local fixture HTTP server. */
export function localProviderDefinitions(product: TFixtureProduct) {
  const base = createGemmaProviderDefinition();
  return [{
    ...base,
    defaults: { model: 'fixture-model', baseURL: providerUrl(product) },
    modelCatalog: {
      status: 'fallback' as const,
      entries: [{ id: 'fixture-model', displayName: 'Local Fixture Model', capabilities: ['streaming', 'tools'] as const }],
    },
  }];
}
