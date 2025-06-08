import { describe, it, expect, beforeEach } from 'vitest';
import { Robota } from '../robota';
import { SimpleConversationHistory } from '../conversation-history';
import type { Context, ModelResponse, AIProvider } from '../interfaces/ai-provider';

// Mock AI Provider class
class MockProvider implements AIProvider {
    public name = 'mock';
    public availableModels = ['mock-model'];
    public lastContext: Context | null = null;
    public mockResponse: ModelResponse = { content: 'Hello!' };
    public mockOptions: any = {};

    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        this.lastContext = context;
        this.mockOptions = options || {};
        return this.mockResponse;
    }

    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<any, void, unknown> {
        this.lastContext = context;
        this.mockOptions = options || {};
        const chunk = { content: this.mockResponse.content };
        yield chunk;
    }
}

describe('Robota', () => {
    let mockProvider: MockProvider;
    let robota: Robota;

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
            expect(robota.getCurrentAI()).toEqual({ provider: 'mock', model: 'mock-model' });
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

            expect(customRobota.getCurrentAI()).toEqual({ provider: 'mock', model: 'mock-model' });
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

            expect(customRobota['systemMessageManager'].getSystemMessages()).toEqual(systemMessages);
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

            expect(customRobota['functionCallManager'].getDefaultMode()).toBe('auto');
            expect(customRobota['functionCallManager'].getMaxCalls()).toBe(5);
            expect(customRobota['functionCallManager'].getTimeout()).toBe(10000);
            expect(customRobota['functionCallManager'].getAllowedFunctions()).toEqual(['getWeather']);
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

    describe('chat method', () => {
        it('should maintain chat history', async () => {
            mockProvider.mockResponse = { content: 'First response' };
            await robota.chat('First message');

            // Check if user message and response are saved in conversation history
            expect(robota['conversationHistory'].getMessageCount()).toBe(2);
            const messages = robota['conversationHistory'].getMessages();
            expect(messages[0].role).toBe('user');
            expect(messages[0].content).toBe('First message');
            expect(messages[1].role).toBe('assistant');
            expect(messages[1].content).toBe('First response');

            // Two second message
            mockProvider.mockResponse = { content: 'Second response' };
            await robota.chat('Second message');

            // Check full conversation history
            const allMessages = robota['conversationHistory'].getMessages();
            expect(allMessages).toHaveLength(4);
            expect(allMessages[2].role).toBe('user');
            expect(allMessages[2].content).toBe('Second message');
            expect(allMessages[3].role).toBe('assistant');
            expect(allMessages[3].content).toBe('Second response');
        });
    });

    describe('Function calls', () => {
        it('should be able to set function call mode', async () => {
            // Set function call mode
            robota.setFunctionCallMode('auto');
            expect(robota['functionCallManager'].getDefaultMode()).toBe('auto');

            await robota.run('Test message');
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');

            // Change to different mode
            robota.setFunctionCallMode('disabled');
            expect(robota['functionCallManager'].getDefaultMode()).toBe('disabled');

            await robota.run('Test message');
            expect(mockProvider.mockOptions.functionCallMode).toBe('disabled');
        });

        it('should be able to override function call mode in run method', async () => {
            // Set default mode
            robota.setFunctionCallMode('auto');

            // Override on execution
            await robota.run('Test message', { functionCallMode: 'disabled' });
            expect(mockProvider.mockOptions.functionCallMode).toBe('disabled');

            // Execute with default mode again
            await robota.run('Test message');
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');
        });

        it('should be able to specify forced function and arguments in force mode', async () => {
            const forcedFunction = 'getWeather';
            const forcedArguments = { location: 'Seoul' };

            await robota.run('Hello', {
                functionCallMode: 'force',
                forcedFunction,
                forcedArguments
            });

            expect(mockProvider.mockOptions.functionCallMode).toBe('force');
            expect(mockProvider.mockOptions.forcedFunction).toBe(forcedFunction);
            expect(mockProvider.mockOptions.forcedArguments).toEqual(forcedArguments);
        });

        it('should be able to change function call configuration with configureFunctionCall', async () => {
            robota.configureFunctionCall({
                mode: 'auto',
                maxCalls: 5,
                timeout: 10000,
                allowedFunctions: ['getWeather', 'calculate']
            });

            await robota.run('Hello');

            expect(robota['functionCallManager'].getDefaultMode()).toBe('auto');
            expect(robota['functionCallManager'].getMaxCalls()).toBe(5);
            expect(robota['functionCallManager'].getTimeout()).toBe(10000);
            expect(robota['functionCallManager'].getAllowedFunctions()).toEqual(['getWeather', 'calculate']);
            expect(mockProvider.mockOptions.functionCallMode).toBe('auto');
        });
    });

    describe('System messages', () => {
        it('should be able to set single system message with setSystemPrompt', async () => {
            const systemPrompt = 'You are an expert.';
            robota.setSystemPrompt(systemPrompt);

            await robota.run('Hello');

            expect(mockProvider.lastContext?.systemPrompt).toBe(systemPrompt);
        });

        it('should be able to set multiple system messages with setSystemMessages', async () => {
            const systemMessages = [
                { role: 'system' as const, content: 'You are an expert.' },
                { role: 'system' as const, content: 'Provide accurate information.' }
            ];

            robota.setSystemMessages(systemMessages);

            await robota.run('Hello');

            expect(mockProvider.lastContext?.systemMessages).toEqual(systemMessages);
        });

        it('should be able to add system message with addSystemMessage', async () => {
            robota.setSystemPrompt('You are an expert.');
            robota.addSystemMessage('Provide accurate information.');

            await robota.run('Hello');

            const expectedMessages = [
                { role: 'system' as const, content: 'You are an expert.' },
                { role: 'system' as const, content: 'Provide accurate information.' }
            ];
            expect(mockProvider.lastContext?.systemMessages).toEqual(expectedMessages);
        });
    });
}); 