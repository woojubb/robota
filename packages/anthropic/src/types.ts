import Anthropic from '@anthropic-ai/sdk';
import type { IExecutor } from '@robota-sdk/agents';

/**
 * Valid provider option value types
 */
export type TProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | Anthropic
  | IExecutor
  | TProviderOptionValue[]
  | { [key: string]: TProviderOptionValue };

/**
 * Base provider options interface
 */
export interface IProviderOptions {
    /**
     * Additional provider-specific options
     */
    [key: string]: TProviderOptionValue;
}

/**
 * Anthropic provider options
 * 
 * Note: Anthropic API doesn't support response format configuration.
 * JSON output can be requested through prompt instructions.
 */
export interface IAnthropicProviderOptions extends IProviderOptions {
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
    executor?: IExecutor;
} 