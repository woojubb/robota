import Anthropic from '@anthropic-ai/sdk';
import type { ExecutorInterface } from '@robota-sdk/agents';

/**
 * Valid provider option value types
 */
export type ProviderOptionValue = string | number | boolean | undefined | null | Anthropic | ExecutorInterface | ProviderOptionValue[] | { [key: string]: ProviderOptionValue };

/**
 * Base provider options interface
 */
export interface ProviderOptions {
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
export interface AnthropicProviderOptions extends ProviderOptions {
    /**
     * Anthropic API key (required when client is not provided)
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
     * Anthropic client instance (optional: will be created from apiKey if not provided)
     */
    client?: Anthropic;

    /**
     * Optional executor for handling AI requests
     * 
     * When provided, the provider will delegate all chat operations to this executor
     * instead of making direct API calls. This enables remote execution capabilities.
     * 
     * @example
     * ```typescript
     * import { LocalExecutor, RemoteExecutor } from '@robota-sdk/agents';
     * 
     * // Local execution (registers this provider)
     * const localExecutor = new LocalExecutor();
     * localExecutor.registerProvider('anthropic', new AnthropicProvider({ apiKey: 'sk-ant-...' }));
     * 
     * // Remote execution
     * const remoteExecutor = new RemoteExecutor({
     *   serverUrl: 'https://api.robota.io',
     *   userApiKey: 'user-token-123'
     * });
     * 
     * const provider = new AnthropicProvider({
     *   executor: remoteExecutor // No direct API key needed
     * });
     * ```
     */
    executor?: ExecutorInterface;
} 