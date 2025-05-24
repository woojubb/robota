import { ProviderOptions } from '@robota-sdk/core';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic provider options
 */
export interface AnthropicProviderOptions extends ProviderOptions {
    /**
     * Anthropic API key (optional: not required when using client)
     */
    apiKey?: string;

    /**
     * API request timeout (milliseconds)
     */
    timeout?: number;

    /**
     * API base URL
     */
    baseURL?: string;

    /**
     * Anthropic client instance (required)
     */
    client: Anthropic;
} 