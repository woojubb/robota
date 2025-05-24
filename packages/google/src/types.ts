import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Google AI Provider options
 */
export interface GoogleProviderOptions {
    /** Google AI client instance */
    client: GoogleGenerativeAI;

    /** Default model to use */
    model?: string;

    /** Temperature setting (0.0 ~ 1.0) */
    temperature?: number;

    /** Maximum number of tokens */
    maxTokens?: number;

    /** Response format */
    responseFormat?: string;
} 