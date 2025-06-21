import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProviderOptions } from '@robota-sdk/agents';

/**
 * Google AI Provider options
 */
export interface GoogleProviderOptions extends Omit<ProviderOptions, 'model'> {
    /** Google AI client instance */
    client: GoogleGenerativeAI;

    /** Default model to use */
    model?: string;

    /** Temperature setting (0.0 ~ 1.0) */
    temperature?: number;

    /** Maximum number of tokens */
    maxTokens?: number;

    /** 
     * Response MIME type
     * - 'text/plain': Plain text response (default)
     * - 'application/json': JSON response format
     */
    responseMimeType?: 'text/plain' | 'application/json';

    /** 
     * Response schema for JSON output (only used when responseMimeType is 'application/json')
     */
    responseSchema?: Record<string, unknown>;
} 