import { describe, it, expect, vi } from 'vitest';
import { ConversationService } from './index';
import {
    createUserMessageStatic,
    createAssistantMessageStatic,
    createSystemMessageStatic,
    createToolMessageStatic,
    convertToProviderMetadata,
    convertUsage,
    processProviderResponse,
    processStreamingChunk,
    executeWithRetry
} from './message-helpers';
import { NetworkError } from '../../utils/errors';
import type { ILogger } from '../../utils/logger';

function mockLogger(): ILogger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('ConversationService', () => {
    const service = new ConversationService();

    describe('prepareContext', () => {
        it('builds context from messages', () => {
            const messages = [{ role: 'user' as const, content: 'hi', timestamp: new Date() }];
            const ctx = service.prepareContext(messages, 'gpt-4', 'openai');
            expect(ctx.model).toBe('gpt-4');
            expect(ctx.provider).toBe('openai');
            expect(ctx.messages).toHaveLength(1);
        });

        it('trims history to maxHistoryLength', () => {
            const messages = Array.from({ length: 150 }, (_, i) => ({
                role: 'user' as const,
                content: `msg-${i}`,
                timestamp: new Date()
            }));
            const ctx = service.prepareContext(messages, 'gpt-4', 'openai', {}, { maxHistoryLength: 50 });
            expect(ctx.messages.length).toBeLessThanOrEqual(50);
        });

        it('preserves system messages during trimming', () => {
            const messages = [
                { role: 'system' as const, content: 'sys', timestamp: new Date() },
                ...Array.from({ length: 50 }, (_, i) => ({
                    role: 'user' as const, content: `msg-${i}`, timestamp: new Date()
                }))
            ];
            const ctx = service.prepareContext(messages, 'gpt-4', 'openai', {}, { maxHistoryLength: 10 });
            expect(ctx.messages.some(m => m.role === 'system')).toBe(true);
        });

        it('includes context options', () => {
            const messages = [{ role: 'user' as const, content: 'hi', timestamp: new Date() }];
            const ctx = service.prepareContext(messages, 'gpt-4', 'openai', {
                systemMessage: 'You are helpful',
                temperature: 0.7,
                maxTokens: 1000
            });
            expect(ctx.systemMessage).toBe('You are helpful');
            expect(ctx.temperature).toBe(0.7);
            expect(ctx.maxTokens).toBe(1000);
        });
    });

    describe('validateContext', () => {
        it('validates a correct context', () => {
            const result = service.validateContext({
                messages: [{ role: 'user', content: 'hi', timestamp: new Date() }],
                model: 'gpt-4',
                provider: 'openai'
            });
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('rejects empty messages', () => {
            const result = service.validateContext({
                messages: [],
                model: 'gpt-4',
                provider: 'openai'
            });
            expect(result.isValid).toBe(false);
        });

        it('rejects invalid temperature', () => {
            const result = service.validateContext({
                messages: [{ role: 'user', content: 'hi', timestamp: new Date() }],
                model: 'gpt-4',
                provider: 'openai',
                temperature: 5
            });
            expect(result.isValid).toBe(false);
        });

        it('rejects invalid maxTokens', () => {
            const result = service.validateContext({
                messages: [{ role: 'user', content: 'hi', timestamp: new Date() }],
                model: 'gpt-4',
                provider: 'openai',
                maxTokens: -1
            });
            expect(result.isValid).toBe(false);
        });
    });

    describe('message creation', () => {
        it('creates user message', () => {
            const msg = service.createUserMessage('hello');
            expect(msg.role).toBe('user');
            expect(msg.content).toBe('hello');
        });

        it('creates system message', () => {
            const msg = service.createSystemMessage('system prompt');
            expect(msg.role).toBe('system');
        });

        it('creates tool message', () => {
            const msg = service.createToolMessage('tc-1', 'result');
            expect(msg.role).toBe('tool');
            expect(msg.toolCallId).toBe('tc-1');
        });
    });
});

describe('message-helpers', () => {
    describe('createUserMessageStatic', () => {
        it('creates user message with timestamp', () => {
            const msg = createUserMessageStatic('hello');
            expect(msg.role).toBe('user');
            expect(msg.content).toBe('hello');
            expect(msg.timestamp).toBeInstanceOf(Date);
        });
    });

    describe('createAssistantMessageStatic', () => {
        it('creates assistant message from response', () => {
            const msg = createAssistantMessageStatic({
                content: 'hi', toolCalls: [], metadata: {}, finishReason: 'stop'
            });
            expect(msg.role).toBe('assistant');
            expect(msg.content).toBe('hi');
        });

        it('includes tool calls when present', () => {
            const toolCalls = [{ id: 'tc-1', type: 'function' as const, function: { name: 'fn', arguments: '{}' } }];
            const msg = createAssistantMessageStatic({
                content: '', toolCalls, metadata: {}, finishReason: 'tool_calls'
            });
            expect(msg.toolCalls).toEqual(toolCalls);
        });
    });

    describe('createSystemMessageStatic', () => {
        it('creates system message', () => {
            const msg = createSystemMessageStatic('sys');
            expect(msg.role).toBe('system');
        });
    });

    describe('createToolMessageStatic', () => {
        it('creates tool message with string result', () => {
            const msg = createToolMessageStatic('tc-1', 'result');
            expect(msg.content).toBe('result');
        });

        it('creates tool message with object result', () => {
            const msg = createToolMessageStatic('tc-1', { key: 'value' });
            expect(msg.content).toBe('{"key":"value"}');
        });
    });

    describe('convertToProviderMetadata', () => {
        it('returns undefined for undefined input', () => {
            expect(convertToProviderMetadata(undefined)).toBeUndefined();
        });

        it('converts simple values', () => {
            const result = convertToProviderMetadata({ key: 'value', num: 42, flag: true });
            expect(result).toEqual({ key: 'value', num: 42, flag: true });
        });

        it('converts Date to ISO string', () => {
            const date = new Date('2025-01-01T00:00:00Z');
            const result = convertToProviderMetadata({ date });
            expect(result!['date']).toBe(date.toISOString());
        });

        it('JSON-stringifies complex values', () => {
            const result = convertToProviderMetadata({ arr: [1, 2, 3] } as any);
            expect(result!['arr']).toBe('[1,2,3]');
        });
    });

    describe('convertUsage', () => {
        it('returns undefined for no usage', () => {
            expect(convertUsage(undefined)).toBeUndefined();
        });

        it('converts complete usage', () => {
            const result = convertUsage({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
            expect(result).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
        });

        it('returns undefined for partial usage', () => {
            expect(convertUsage({ promptTokens: 10 })).toBeUndefined();
        });
    });

    describe('processProviderResponse', () => {
        it('processes response with defaults', () => {
            const result = processProviderResponse({ content: 'hello' });
            expect(result.content).toBe('hello');
            expect(result.toolCalls).toEqual([]);
            expect(result.finishReason).toBe('stop');
        });

        it('preserves tool calls', () => {
            const toolCalls = [{ id: 'tc-1', type: 'function' as const, function: { name: 'fn', arguments: '{}' } }];
            const result = processProviderResponse({ content: '', toolCalls });
            expect(result.toolCalls).toEqual(toolCalls);
        });
    });

    describe('processStreamingChunk', () => {
        it('processes chunk with defaults', () => {
            const result = processStreamingChunk({});
            expect(result.delta).toBe('');
            expect(result.done).toBe(false);
            expect(result.toolCalls).toEqual([]);
        });

        it('processes chunk with content', () => {
            const result = processStreamingChunk({ delta: 'text', done: true });
            expect(result.delta).toBe('text');
            expect(result.done).toBe(true);
        });
    });

    describe('executeWithRetry', () => {
        const logger = mockLogger();
        const defaultOptions = { maxHistoryLength: 100, enableRetry: true, maxRetries: 3, retryDelay: 1, timeout: 5000 };

        it('returns result on first success', async () => {
            const fn = vi.fn().mockResolvedValue('ok');
            const result = await executeWithRetry(fn, 'test', defaultOptions, logger);
            expect(result).toBe('ok');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('retries on network error', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new NetworkError('connection failed'))
                .mockResolvedValue('ok');
            const result = await executeWithRetry(fn, 'test', { ...defaultOptions, retryDelay: 1 }, logger);
            expect(result).toBe('ok');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('does not retry on non-retryable error', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('bad request'));
            await expect(executeWithRetry(fn, 'test', defaultOptions, logger)).rejects.toThrow('bad request');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('retries on timeout error', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('timeout'))
                .mockResolvedValue('ok');
            const result = await executeWithRetry(fn, 'test', { ...defaultOptions, retryDelay: 1 }, logger);
            expect(result).toBe('ok');
        });
    });
});
