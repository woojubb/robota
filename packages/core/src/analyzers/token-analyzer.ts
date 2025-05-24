import { get_encoding, encoding_for_model } from '@dqbd/tiktoken';
import { logger } from '../utils';

/**
 * Token Analyzer class
 * Handles token calculation using tiktoken library
 */
export class TokenAnalyzer {
    /**
     * Calculate tokens for a given text using tiktoken
     * @param text - Text to calculate tokens for
     * @param model - Model name for encoding selection
     * @returns Number of tokens
     */
    calculateTokens(text: string, model?: string): number {
        if (!text) return 0;

        try {
            let encoding;

            // Try to get model-specific encoding first
            if (model) {
                // Map common model names to tiktoken model names
                const modelMapping: Record<string, string> = {
                    'gpt-4': 'gpt-4',
                    'gpt-4-0613': 'gpt-4-0613',
                    'gpt-4-32k': 'gpt-4-32k',
                    'gpt-4-32k-0613': 'gpt-4-32k-0613',
                    'gpt-4-1106-preview': 'gpt-4-1106-preview',
                    'gpt-4-0125-preview': 'gpt-4-0125-preview',
                    'gpt-4-turbo-preview': 'gpt-4-0125-preview',
                    'gpt-3.5-turbo': 'gpt-3.5-turbo',
                    'gpt-3.5-turbo-0613': 'gpt-3.5-turbo-0613',
                    'gpt-3.5-turbo-16k': 'gpt-3.5-turbo-16k',
                    'gpt-3.5-turbo-16k-0613': 'gpt-3.5-turbo-16k-0613',
                    'gpt-3.5-turbo-1106': 'gpt-3.5-turbo-1106',
                    'gpt-3.5-turbo-0125': 'gpt-3.5-turbo-0125'
                };

                const mappedModel = modelMapping[model] || model;

                try {
                    encoding = encoding_for_model(mappedModel as any);
                } catch (error) {
                    // Fall back to cl100k_base encoding for unknown models
                    encoding = get_encoding('cl100k_base');
                }
            } else {
                // Default to cl100k_base encoding (used by GPT-4 and GPT-3.5-turbo)
                encoding = get_encoding('cl100k_base');
            }

            const tokens = encoding.encode(text);
            const tokenCount = tokens.length;

            // Clean up encoding to prevent memory leaks
            encoding.free();

            return tokenCount;
        } catch (error) {
            logger.warn('Failed to calculate tokens with tiktoken, using estimation:', error);
            return Math.ceil(text.length / 4);
        }
    }

    /**
     * Calculate tokens for an array of messages
     * @param messages - Array of messages to calculate tokens for
     * @param model - Model name for encoding selection
     * @returns Number of tokens
     */
    calculateMessagesTokens(messages: any[], model?: string): number {
        if (!messages || messages.length === 0) return 0;

        try {
            let totalTokens = 0;

            // Calculate tokens for each message
            for (const message of messages) {
                if (message.content) {
                    totalTokens += this.calculateTokens(message.content, model);
                }

                // Add tokens for message structure (role, etc.)
                // Based on OpenAI's token counting methodology
                totalTokens += 3; // Every message follows <|start|>{role/name}\n{content}<|end|>\n

                if (message.name) {
                    totalTokens += this.calculateTokens(message.name, model);
                }
            }

            // Add 3 tokens for assistant's reply primer
            totalTokens += 3;

            return totalTokens;
        } catch (error) {
            logger.warn('Failed to calculate message tokens, using estimation:', error);
            // Fall back to simple estimation
            const totalText = messages
                .map(m => (m.content || '') + (m.name || ''))
                .join(' ');
            return Math.ceil(totalText.length / 4);
        }
    }
} 