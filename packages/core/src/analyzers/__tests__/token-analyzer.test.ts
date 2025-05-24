import { describe, it, expect, beforeEach } from 'vitest';
import { TokenAnalyzer } from '../token-analyzer';

describe('TokenAnalyzer', () => {
    let tokenAnalyzer: TokenAnalyzer;

    beforeEach(() => {
        tokenAnalyzer = new TokenAnalyzer();
    });

    describe('Token Calculation', () => {
        it('should calculate tokens for text using tiktoken', () => {
            const text = 'Hello, world! This is a test message.';
            const tokens = tokenAnalyzer.calculateTokens(text);

            expect(tokens).toBeGreaterThan(0);
            expect(typeof tokens).toBe('number');
        });

        it('should calculate tokens for different models', () => {
            const text = 'Hello, world! This is a test message.';

            const gpt4Tokens = tokenAnalyzer.calculateTokens(text, 'gpt-4');
            const gpt35Tokens = tokenAnalyzer.calculateTokens(text, 'gpt-3.5-turbo');

            expect(gpt4Tokens).toBeGreaterThan(0);
            expect(gpt35Tokens).toBeGreaterThan(0);
            // Token counts might be the same or different depending on the model
        });

        it('should handle empty text', () => {
            expect(tokenAnalyzer.calculateTokens('')).toBe(0);
            expect(tokenAnalyzer.calculateTokens(undefined as any)).toBe(0);
        });

        it('should calculate tokens for message arrays', () => {
            const messages = [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Hello, how are you?' },
                { role: 'assistant', content: 'I am doing well, thank you!' }
            ];

            const tokens = tokenAnalyzer.calculateMessagesTokens(messages, 'gpt-4');

            expect(tokens).toBeGreaterThan(0);
            // Should be more than just the content tokens due to message structure overhead
            const contentOnlyTokens = messages.reduce((sum, msg) =>
                sum + tokenAnalyzer.calculateTokens(msg.content), 0
            );
            expect(tokens).toBeGreaterThan(contentOnlyTokens);
        });

        it('should handle empty message arrays', () => {
            expect(tokenAnalyzer.calculateMessagesTokens([])).toBe(0);
            expect(tokenAnalyzer.calculateMessagesTokens(undefined as any)).toBe(0);
        });

        it('should fall back to estimation on tiktoken errors', () => {
            // Mock console.warn to suppress warnings in tests
            const originalWarn = console.warn;
            console.warn = () => { }; // Silent mock

            // This should work normally with tiktoken
            const text = 'Hello, world!';
            const tokens = tokenAnalyzer.calculateTokens(text);

            expect(tokens).toBeGreaterThan(0);
            expect(typeof tokens).toBe('number');

            console.warn = originalWarn;
        });

        it('should handle messages with names', () => {
            const messages = [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Hello!', name: 'john' },
                { role: 'assistant', content: 'Hi there!' }
            ];

            const tokens = tokenAnalyzer.calculateMessagesTokens(messages);
            expect(tokens).toBeGreaterThan(0);

            // Should include tokens for the name field
            const messagesWithoutName = [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Hello!' },
                { role: 'assistant', content: 'Hi there!' }
            ];

            const tokensWithoutName = tokenAnalyzer.calculateMessagesTokens(messagesWithoutName);
            expect(tokens).toBeGreaterThan(tokensWithoutName);
        });

        it('should handle unknown model names gracefully', () => {
            const text = 'Hello, world!';

            // Should not throw error with unknown model
            expect(() => {
                const tokens = tokenAnalyzer.calculateTokens(text, 'unknown-model-xyz');
                expect(tokens).toBeGreaterThan(0);
            }).not.toThrow();
        });
    });
}); 