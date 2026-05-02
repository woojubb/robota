/**
 * @robota-sdk/agent-provider-google compatibility package.
 *
 * New code should import from @robota-sdk/agent-provider-gemini.
 */

export { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
export type {
  IGeminiProviderOptions,
  TGeminiProviderOptionValue,
} from '@robota-sdk/agent-provider-gemini';
export * from './provider.js';
export * from './provider-definition.js';
export * from './types.js';
