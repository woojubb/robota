import type {
  IGeminiProviderOptions,
  TGeminiProviderOptionValue,
} from '@robota-sdk/agent-provider-gemini';

export type TGoogleProviderOptionValue = TGeminiProviderOptionValue;

export interface IGoogleProviderOptions extends IGeminiProviderOptions {}
