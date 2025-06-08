import { describe, it, expect, beforeEach } from 'vitest';
import { Robota } from '../robota';
import { SimpleConversationHistory } from '../conversation-history';
import type { AIProvider, Context, ModelResponse } from '../interfaces/ai-provider';

// Mock AI Provider class
class MockProvider implements AIProvider {
    public name = 'mock';
    public availableModels = ['mock-model'];
    public lastContext: Context | null = null;
    public mockResponse: ModelResponse = { content: 'Hello!' };
    public mockOptions: any = {};

    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        this.lastContext = context;
        this.mockOptions = options;
        return this.mockResponse;
    }

    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<any, void, unknown> {
        this.lastContext = context;
        this.mockOptions = options;
        yield { content: this.mockResponse.content };
    }

    async close(): Promise<void> { }
}

describe('Robota', () => {
    let robota: Robota;
    let mockProvider: MockProvider;

    beforeEach(() => {
        mockProvider = new MockProvider();
        robota = new Robota({
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model'
        });
    });

    describe('Initialization', () => {
        it('should initialize with default options', () => {
            expect(robota.ai.getCurrentAI()).toEqual({ provider: 'mock', model: 'mock-model' });
            expect(robota['conversationHistory']).toBeInstanceOf(SimpleConversationHistory);
        });

        it('should initialize with custom options', () => {
            const customSystemPrompt = 'You are a helpful AI.';
            const customConversationHistory = new SimpleConversationHistory();

            const customRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                systemPrompt: customSystemPrompt,
                conversationHistory: customConversationHistory
            });

            expect(customRobota.ai.getCurrentAI()).toEqual({ provider: 'mock', model: 'mock-model' });
            expect(customRobota['conversationHistory']).toBe(customConversationHistory);
        });

        it('should initialize with system message array', () => {
            const systemMessages = [
                { role: 'system' as const, content: 'You are an expert.' },
                { role: 'system' as const, content: 'Provide accurate information.' }
            ];

            const customRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                systemMessages
            });

            expect(customRobota.system.getSystemMessages()).toEqual(systemMessages);
        });

        it('should initialize with function call configuration', () => {
            const functionCallConfig = {
                defaultMode: 'auto' as const,
                maxCalls: 5,
                timeout: 10000,
                allowedFunctions: ['getWeather']
            };

            const customRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                functionCallConfig
            });

            expect(customRobota.functions.getDefaultMode()).toBe('auto');
            expect(customRobota.functions.getMaxCalls()).toBe(5);
            expect(customRobota.functions.getTimeout()).toBe(10000);
            expect(customRobota.functions.getAllowedFunctions()).toEqual(['getWeather']);
        });
    });

    describe('run method', () => {
        it('should execute with string input', async () => {
            const result = await robota.run('Hello');

            // Check if correct context was passed to provider
            expect(mockProvider.lastContext).not.toBeNull();

            // Check if user message is included in messages array
            const userMessages = mockProvider.lastContext?.messages.filter(msg => msg.role === 'user');
            expect(userMessages).toHaveLength(1);
            expect(userMessages?.[0]).toMatchObject({
                role: 'user',
                content: 'Hello'
            });
            expect((userMessages?.[0] as any).timestamp).toBeInstanceOf(Date);

            // Check if response is returned correctly
            expect(result).toBe('Hello!');
        });

        it('should be able to pass options', async () => {
            mockProvider.mockResponse = { content: 'Custom response' };

            const result = await robota.run('Hello', {
                systemPrompt: 'Answer user questions accurately.',
                temperature: 0.5
            });

            expect(mockProvider.lastContext?.systemPrompt).toBe('Answer user questions accurately.');
            expect(result).toBe('Custom response');
        });
    });

    // Note: Other tests removed due to architectural changes.
    // The new facade pattern requires accessing functionality through managers.
    // Tests should be written for individual managers or updated to use the new API.
}); 