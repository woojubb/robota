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
    constructor(options: AnthropicProviderOptions) {
        // Initialization logic
    }

    // To be implemented
}

export * from './types';
export * from './provider'; 