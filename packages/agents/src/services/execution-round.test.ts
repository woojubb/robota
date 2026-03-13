import { describe, it, expect } from 'vitest';
import {
    computeRoundThinkingContext,
    validateAndExtractResponse,
    callProviderWithCache,
    addToolResultsToHistory
} from './execution-round';
import type { ILogger } from '../utils/logger';
import { vi } from 'vitest';

function mockLogger(): ILogger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() };
}

function createResolvedProviderInfo(overrides: Partial<Record<string, unknown>> = {}): any {
    return {
        provider: { chat: vi.fn() },
        currentInfo: { provider: 'openai' },
        aiProviderInfo: { providerName: 'openai', model: 'gpt-4', temperature: undefined, maxTokens: undefined },
        toolsInfo: [],
        availableTools: [],
        ...overrides
    };
}

describe('execution-round helpers', () => {
    describe('computeRoundThinkingContext', () => {
        it('generates thinkingNodeId based on conversationId and count', () => {
            const result = computeRoundThinkingContext('conv-1', {
                currentRound: 1,
                runningAssistantCount: 0,
                toolsExecuted: [],
                lastTrackedAssistantMessage: undefined
            });
            expect(result.thinkingNodeId).toBe('thinking_conv-1_round1');
            expect(result.previousThinkingNodeId).toBeUndefined();
        });

        it('chains from previous tool result when assistant had tool calls', () => {
            const result = computeRoundThinkingContext('conv-1', {
                currentRound: 2,
                runningAssistantCount: 1,
                toolsExecuted: ['search'],
                lastTrackedAssistantMessage: {
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    toolCalls: [{ id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{}' } }]
                }
            });
            expect(result.thinkingNodeId).toBe('thinking_conv-1_round2');
            expect(result.previousThinkingNodeId).toBe('thinking_conv-1_round1');
        });
    });

    describe('validateAndExtractResponse', () => {
        const logger = mockLogger();

        it('extracts assistant response with content', () => {
            const response = {
                role: 'assistant' as const,
                content: 'hello',
                timestamp: new Date()
            };
            const result = validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger);
            expect(result.assistantResponse.content).toBe('hello');
            expect(result.assistantToolCalls).toEqual([]);
        });

        it('extracts tool calls from response', () => {
            const toolCalls = [{ id: 'tc-1', type: 'function' as const, function: { name: 'fn', arguments: '{}' } }];
            const response = {
                role: 'assistant' as const,
                content: null,
                timestamp: new Date(),
                toolCalls
            };
            const result = validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger);
            expect(result.assistantToolCalls).toHaveLength(1);
        });

        it('throws for non-assistant response', () => {
            const response = {
                role: 'user' as const,
                content: 'hello',
                timestamp: new Date()
            };
            expect(() => validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger))
                .toThrow('Unexpected response role: user');
        });

        it('throws when response has no content and no tool calls', () => {
            const response = {
                role: 'assistant' as const,
                content: undefined as any,
                timestamp: new Date()
            };
            expect(() => validateAndExtractResponse(response, 'exec-1', 'conv-1', 1, logger))
                .toThrow('Provider response must have content or tool calls');
        });
    });

    describe('callProviderWithCache', () => {
        it('throws when model is empty string', async () => {
            const config = { name: 'test', defaultModel: { provider: 'openai', model: '' } };
            const resolved = createResolvedProviderInfo();
            // Empty string is falsy, hits the first guard
            await expect(callProviderWithCache([], config as any, resolved))
                .rejects.toThrow('Model is required');
        });

        it('throws when model is whitespace only', async () => {
            const config = { name: 'test', defaultModel: { provider: 'openai', model: '  ' } };
            const resolved = createResolvedProviderInfo();
            await expect(callProviderWithCache([], config as any, resolved))
                .rejects.toThrow('Model must be a non-empty string');
        });

        it('throws when model is missing', async () => {
            const config = { name: 'test', defaultModel: { provider: 'openai' } };
            const resolved = createResolvedProviderInfo();
            await expect(callProviderWithCache([], config as any, resolved))
                .rejects.toThrow('Model is required');
        });

        it('calls provider without cache', async () => {
            const mockResponse = { role: 'assistant', content: 'hi', timestamp: new Date() };
            const resolved = createResolvedProviderInfo({
                provider: { chat: vi.fn().mockResolvedValue(mockResponse) }
            });
            const config = { name: 'test', defaultModel: { provider: 'openai', model: 'gpt-4' } };
            const result = await callProviderWithCache(
                [{ role: 'user', content: 'hello', timestamp: new Date() }],
                config as any,
                resolved
            );
            expect(result).toBe(mockResponse);
            expect(resolved.provider.chat).toHaveBeenCalled();
        });

        it('uses cached response when available', async () => {
            const config = { name: 'test', defaultModel: { provider: 'openai', model: 'gpt-4' } };
            const resolved = createResolvedProviderInfo();
            const cacheService = {
                lookup: vi.fn().mockReturnValue('cached response'),
                store: vi.fn()
            };
            const result = await callProviderWithCache([], config as any, resolved, cacheService as any);
            expect(result.content).toBe('cached response');
            expect(resolved.provider.chat).not.toHaveBeenCalled();
        });

        it('stores response in cache on miss', async () => {
            const mockResponse = { role: 'assistant', content: 'fresh', timestamp: new Date() };
            const config = { name: 'test', defaultModel: { provider: 'openai', model: 'gpt-4' } };
            const resolved = createResolvedProviderInfo({
                provider: { chat: vi.fn().mockResolvedValue(mockResponse) }
            });
            const cacheService = {
                lookup: vi.fn().mockReturnValue(undefined),
                store: vi.fn()
            };
            await callProviderWithCache([], config as any, resolved, cacheService as any);
            expect(cacheService.store).toHaveBeenCalled();
        });
    });

    describe('addToolResultsToHistory', () => {
        const logger = mockLogger();

        it('adds successful tool results to session', () => {
            const toolCalls = [
                { id: 'tc-1', type: 'function' as const, function: { name: 'search', arguments: '{}' } }
            ];
            const toolSummary = {
                results: [{ executionId: 'tc-1', toolName: 'search', success: true, result: 'found it' }],
                errors: []
            };
            const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

            addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger);
            expect(session.addToolMessageWithId).toHaveBeenCalledWith(
                'found it', 'tc-1', 'search', expect.objectContaining({ success: true })
            );
        });

        it('adds failed tool results to session', () => {
            const toolCalls = [
                { id: 'tc-1', type: 'function' as const, function: { name: 'search', arguments: '{}' } }
            ];
            const toolSummary = {
                results: [{ executionId: 'tc-1', toolName: 'search', success: false, error: 'not found' }],
                errors: []
            };
            const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

            addToolResultsToHistory(toolCalls, toolSummary, session as any, 1, logger);
            expect(session.addToolMessageWithId).toHaveBeenCalledWith(
                'Error: not found', 'tc-1', 'search', expect.objectContaining({ success: false })
            );
        });

        it('throws when tool call has no ID', () => {
            const toolCalls = [{ type: 'function' as const, function: { name: 'search', arguments: '{}' } }] as any;
            const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

            expect(() => addToolResultsToHistory(toolCalls, { results: [], errors: [] }, session as any, 1, logger))
                .toThrow('Tool call missing ID');
        });

        it('throws when no result found for tool call', () => {
            const toolCalls = [
                { id: 'tc-1', type: 'function' as const, function: { name: 'search', arguments: '{}' } }
            ];
            const session = { getMessages: () => [], addToolMessageWithId: vi.fn() };

            expect(() => addToolResultsToHistory(toolCalls, { results: [], errors: [] }, session as any, 1, logger))
                .toThrow('No execution result found for tool call ID: tc-1');
        });
    });
});
