import type { ExecutorInterface } from '@robota-sdk/agents';

/**
 * Valid provider option value types
 */
export type ProviderOptionValue = string | number | boolean | undefined | null | ExecutorInterface | ProviderOptionValue[] | { [key: string]: ProviderOptionValue };

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
 * Google AI Provider options
 */
export interface GoogleProviderOptions extends ProviderOptions {
    /** Google AI API key */
    apiKey: string;

    /** 
     * Response MIME type
     * - 'text/plain': Plain text response (default)
     * - 'application/json': JSON response format
     */
    responseMimeType?: 'text/plain' | 'application/json';

    /** 
     * Response schema for JSON output (only used when responseMimeType is 'application/json')
     */
    responseSchema?: Record<string, ProviderOptionValue>;

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
     * localExecutor.registerProvider('google', new GoogleProvider({ apiKey: 'AIza...' }));
     * 
     * // Remote execution
     * const remoteExecutor = new RemoteExecutor({
     *   serverUrl: 'https://api.robota.io',
     *   userApiKey: 'user-token-123'
     * });
     * 
     * const provider = new GoogleProvider({
     *   apiKey: 'placeholder', // Required for type safety but not used
     *   executor: remoteExecutor
     * });
     * ```
     */
    executor?: ExecutorInterface;
} 