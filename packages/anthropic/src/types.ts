import Anthropic from '@anthropic-ai/sdk';

/**
 * Valid provider option value types
 */
export type ProviderOptionValue = string | number | boolean | undefined | null | Anthropic | ProviderOptionValue[] | { [key: string]: ProviderOptionValue };

/**
 * Base provider options interface
 */
export interface ProviderOptions {
    /**
     * Model name to use
     */
    model?: string;

    /**
     * Additional provider-specific options
     */
    [key: string]: ProviderOptionValue;
}

/**
 * Anthropic provider options
 * 
 * Note: Anthropic API doesn't support response format configuration.
 * JSON output can be requested through prompt instructions.
 */
export interface AnthropicProviderOptions extends Omit<ProviderOptions, 'model'> {
    /**
     * Default model to use
     */
    model?: string;

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