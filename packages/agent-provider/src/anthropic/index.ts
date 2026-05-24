/**
 * @robota-sdk/agent-provider (anthropic)
 *
 * Provides Provider implementation for using Anthropic API with provider-agnostic TUniversalMessage.
 */

// Main exports
export * from './provider';
export * from './types';
export * from './provider-definition';
export * from './model-catalog-refresh';

import { AnthropicProvider } from './provider';

import type { IAnthropicProviderOptions } from './types';
import type { IAIProvider } from '@robota-sdk/agent-core';

export function createAnthropicProvider(options: IAnthropicProviderOptions): IAIProvider {
  return new AnthropicProvider(options);
}
