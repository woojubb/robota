import type {
  IGeminiProviderOptions,
  TGeminiProviderOptionValue,
} from '@robota-sdk/agent-provider-gemini';

/**
 * @deprecated Use `TGeminiProviderOptionValue` from `@robota-sdk/agent-provider-gemini`.
 */
export type TGoogleProviderOptionValue = TGeminiProviderOptionValue;

/**
 * @deprecated Use `IGeminiProviderOptions` from `@robota-sdk/agent-provider-gemini`.
 */
export interface IGoogleProviderOptions extends IGeminiProviderOptions {}
