import { ProviderOptions } from '@robota-sdk/core';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic provider options
 * 
 * Note: Anthropic API doesn't support response format configuration.
 * JSON output can be requested through prompt instructions.
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

    /**
     * Enable payload logging to files for debugging
     */
    enablePayloadLogging?: boolean;

    /**
     * Directory to save payload log files
     */
    payloadLogDir?: string;

    /**
     * Include timestamp in log file names
     */
    includeTimestampInLogFiles?: boolean;
} 