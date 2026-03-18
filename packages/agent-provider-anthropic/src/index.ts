/**
 * @robota-sdk/agent-provider-anthropic package
 *
 * Provides Provider implementation for using Anthropic API with provider-agnostic TUniversalMessage.
 */

// Main exports
export * from './provider';
export * from './types';

import type { IAnthropicProviderOptions } from './types';

/**
 * Factory function for creating an AnthropicProvider instance.
 * @param _options - Configuration options for the Anthropic provider
 * @returns An AnthropicProvider instance
 */
export function createAnthropicProvider(_options: IAnthropicProviderOptions) {
  // Implementation of createAnthropicProvider function
}
