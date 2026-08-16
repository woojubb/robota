/**
 * What this provider can and cannot do. PROV-006.
 *
 * Split out of `provider.ts` to keep it under the size ceiling, and because the two answers here
 * are about different granularities: `DEEPSEEK_PROVIDER_CAPABILITIES` speaks for the VENDOR, while
 * the per-MODEL answer lives in `model-catalog.ts` — and the whole defect this item fixed was those
 * two disagreeing with only the vendor-level one being read.
 */

import type { IProviderCapabilities } from '@robota-sdk/agent-core';

const NOT_NATIVE_WEB_REASON_PREFIX =
  'DeepSeek OpenAI-compatible Chat Completions supports declared function tools, not provider-native';

/** Vendor-level capabilities. The per-MODEL answer is `DEEPSEEK_MODEL_CATALOG`. */
export const DEEPSEEK_PROVIDER_CAPABILITIES: IProviderCapabilities = {
  functionCalling: { supported: true },
  nativeWebTools: {
    webSearch: {
      supported: false,
      enabled: false,
      source: 'openai-compatible-chat-completions',
      reason: `${NOT_NATIVE_WEB_REASON_PREFIX} web search.`,
    },
    webFetch: {
      supported: false,
      enabled: false,
      source: 'openai-compatible-chat-completions',
      reason: `${NOT_NATIVE_WEB_REASON_PREFIX} web fetch.`,
    },
  },
};
