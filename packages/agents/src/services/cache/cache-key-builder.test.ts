import { describe, it, expect } from 'vitest';
import { CacheKeyBuilder } from './cache-key-builder';
import type { TUniversalMessage } from '../../interfaces/messages';

describe('CacheKeyBuilder', () => {
    const builder = new CacheKeyBuilder();

    const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hello', timestamp: new Date('2024-01-01') }
    ];

    it('should produce consistent hash for identical inputs', () => {
        const key1 = builder.build(messages, 'gpt-4', 'openai');
        const key2 = builder.build(messages, 'gpt-4', 'openai');

        expect(key1.hash).toBe(key2.hash);
        expect(key1.model).toBe('gpt-4');
        expect(key1.provider).toBe('openai');
    });

    it('should produce different hashes for different messages', () => {
        const otherMessages: TUniversalMessage[] = [
            { role: 'user', content: 'Goodbye', timestamp: new Date('2024-01-01') }
        ];

        const key1 = builder.build(messages, 'gpt-4', 'openai');
        const key2 = builder.build(otherMessages, 'gpt-4', 'openai');

        expect(key1.hash).not.toBe(key2.hash);
    });

    it('should produce different hashes for different models', () => {
        const key1 = builder.build(messages, 'gpt-4', 'openai');
        const key2 = builder.build(messages, 'gpt-3.5-turbo', 'openai');

        expect(key1.hash).not.toBe(key2.hash);
    });

    it('should produce different hashes for different providers', () => {
        const key1 = builder.build(messages, 'gpt-4', 'openai');
        const key2 = builder.build(messages, 'gpt-4', 'anthropic');

        expect(key1.hash).not.toBe(key2.hash);
    });

    it('should exclude timestamps from hash computation', () => {
        const messages1: TUniversalMessage[] = [
            { role: 'user', content: 'Hello', timestamp: new Date('2024-01-01') }
        ];
        const messages2: TUniversalMessage[] = [
            { role: 'user', content: 'Hello', timestamp: new Date('2025-06-15') }
        ];

        const key1 = builder.build(messages1, 'gpt-4', 'openai');
        const key2 = builder.build(messages2, 'gpt-4', 'openai');

        expect(key1.hash).toBe(key2.hash);
    });

    it('should include temperature and maxTokens when provided', () => {
        const key1 = builder.build(messages, 'gpt-4', 'openai', { temperature: 0.7 });
        const key2 = builder.build(messages, 'gpt-4', 'openai', { temperature: 0.9 });

        expect(key1.hash).not.toBe(key2.hash);
    });

    it('should compute integrity hash for response content', () => {
        const hash = builder.computeIntegrityHash('Hello world');

        expect(hash).toBeTruthy();
        expect(typeof hash).toBe('string');
        expect(hash).toBe(builder.computeIntegrityHash('Hello world'));
    });
});
