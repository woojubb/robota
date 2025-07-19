/**
 * Valid provider option value types
 */
export type ProviderOptionValue = string | number | boolean | undefined | null | ProviderOptionValue[] | { [key: string]: ProviderOptionValue };

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
} 