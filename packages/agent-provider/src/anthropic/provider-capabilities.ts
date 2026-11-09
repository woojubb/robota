/**
 * What this provider can and cannot do at the VENDOR level.
 *
 * Split out of `provider.ts` to keep it under the size ceiling, and because the two capability
 * answers this package gives are about different granularities: this one speaks for the vendor,
 * while `capability-table.ts` answers per MODEL. Keeping them in one file is what let a vendor-level
 * boolean stand in for a per-model fact everywhere else.
 */

import type { IProviderCapabilities } from '@robota-sdk/agent-core';

const CONFIGURE_HINT =
  'Set the provider profile option nativeWebTools.webSearch to true (constructor option enableWebTools).';

/** Vendor-level capabilities, which depend on whether the provider was built with server web search. */
export function anthropicProviderCapabilities(webToolsEnabled: boolean): IProviderCapabilities {
  return {
    functionCalling: { supported: true },
    nativeWebTools: {
      webSearch: webToolsEnabled
        ? { supported: true, enabled: true, source: 'anthropic-messages' }
        : {
            supported: true,
            enabled: false,
            source: 'anthropic-messages',
            reason: CONFIGURE_HINT,
          },
      webFetch: {
        supported: false,
        enabled: false,
        source: 'anthropic-messages',
        reason: 'Anthropic provider exposes server web search only.',
      },
    },
  };
}
