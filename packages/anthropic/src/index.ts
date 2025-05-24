import type { ProviderOptions } from '@robota-sdk/core';

/**
 * Anthropic provider options
 */
export interface AnthropicProviderOptions extends ProviderOptions {
    apiKey: string;
}

/**
 * Anthropic provider class
 */
export class AnthropicProvider {
    constructor(_options: AnthropicProviderOptions) {
        // Initialization logic
    }

    // To be implemented
}

/**
 * @robota-sdk/anthropic package
 * 
 * Provides Provider implementation for using Anthropic API.
 */

// Import all exports from types.ts and provider.ts
export * from './provider';
export * from './types';
export * from './adapter';

export function createAnthropicProvider(_options: AnthropicProviderOptions) {
    // Implementation of createAnthropicProvider function
} 