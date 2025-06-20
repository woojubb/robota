

/**
 * @robota-sdk/anthropic package
 * 
 * Provides Provider implementation for using Anthropic API.
 */

// Import all exports from types.ts and provider.ts
export * from './provider';
export * from './types';
export * from './adapter';
export * from './payload-logger';

import { AnthropicProviderOptions } from './types';

export function createAnthropicProvider(_options: AnthropicProviderOptions) {
    // Implementation of createAnthropicProvider function
} 