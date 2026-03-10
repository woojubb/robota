import { describe, it, expect } from 'vitest';
import { sanitizeOpenAILogData } from './sanitize-openai-log-data';
import type { IOpenAILogData } from '../types/api-types';

describe('sanitizeOpenAILogData', () => {
    it('should return a deep copy of the payload', () => {
        const payload: IOpenAILogData = {
            model: 'gpt-4',
            messagesCount: 3,
            hasTools: true,
            temperature: 0.7,
            maxTokens: 1000,
            timestamp: '2026-01-01T00:00:00.000Z',
        };

        const result = sanitizeOpenAILogData(payload);

        expect(result).toEqual(payload);
        expect(result).not.toBe(payload);
    });

    it('should not modify the original payload', () => {
        const payload: IOpenAILogData = {
            model: 'gpt-4',
            messagesCount: 5,
            hasTools: false,
            timestamp: '2026-01-01T00:00:00.000Z',
        };

        const result = sanitizeOpenAILogData(payload);
        result.model = 'gpt-3.5-turbo';
        result.messagesCount = 999;

        expect(payload.model).toBe('gpt-4');
        expect(payload.messagesCount).toBe(5);
    });

    it('should preserve all fields including optional ones', () => {
        const payload: IOpenAILogData = {
            model: 'gpt-4o',
            messagesCount: 1,
            hasTools: true,
            temperature: 0.5,
            maxTokens: 500,
            timestamp: '2026-03-10T12:00:00.000Z',
            requestId: 'req-123',
        };

        const result = sanitizeOpenAILogData(payload);

        expect(result.model).toBe('gpt-4o');
        expect(result.messagesCount).toBe(1);
        expect(result.hasTools).toBe(true);
        expect(result.temperature).toBe(0.5);
        expect(result.maxTokens).toBe(500);
        expect(result.timestamp).toBe('2026-03-10T12:00:00.000Z');
        expect(result.requestId).toBe('req-123');
    });

    it('should handle payload with undefined optional fields', () => {
        const payload: IOpenAILogData = {
            model: 'gpt-4',
            messagesCount: 2,
            hasTools: false,
            timestamp: '2026-01-01T00:00:00.000Z',
            temperature: undefined,
            maxTokens: undefined,
        };

        const result = sanitizeOpenAILogData(payload);

        // JSON.parse(JSON.stringify(...)) strips undefined fields
        expect(result.model).toBe('gpt-4');
        expect(result.messagesCount).toBe(2);
        expect(result.hasTools).toBe(false);
    });

    it('should handle minimal payload', () => {
        const payload: IOpenAILogData = {
            model: 'gpt-3.5-turbo',
            messagesCount: 0,
            hasTools: false,
            timestamp: '',
        };

        const result = sanitizeOpenAILogData(payload);
        expect(result).toEqual(payload);
    });
});
