import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleConversationHistory, PersistentSystemConversationHistory } from '../conversation-history';
import { ConversationService } from '../services/conversation-service';
import type { AIProvider, Context, ModelResponse } from '../interfaces/ai-provider';

// Mock AI Provider for testing
class MockAIProvider implements AIProvider {
    public name: string;
    public availableModels: string[] = ['mock-model'];
    public lastContext?: Context;

    constructor(name: string) {
        this.name = name;
    }

    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        // Store the context for verification
        this.lastContext = context;

        return {
            content: `Response from ${this.name} using ${model}`,
            usage: {
                promptTokens: 10,
                completionTokens: 20,
                totalTokens: 30
            }
        };
    }

    async close(): Promise<void> {
        // Mock implementation
    }
}

describe('Adapter Pattern Integration Tests', () => {
    let conversationService: ConversationService;
    let openaiProvider: MockAIProvider;
    let anthropicProvider: MockAIProvider;
    let googleProvider: MockAIProvider;

    beforeEach(() => {
        conversationService = new ConversationService();
        openaiProvider = new MockAIProvider('openai');
        anthropicProvider = new MockAIProvider('anthropic');
        googleProvider = new MockAIProvider('google');
    });

    describe('ConversationHistory with Multiple Providers', () => {
        it('should work with SimpleConversationHistory across different providers', async () => {
            const history = new SimpleConversationHistory();

            // Add some messages
            history.addUserMessage('안녕하세요');
            history.addAssistantMessage('안녕하세요! 무엇을 도와드릴까요?');
            history.addUserMessage('날씨가 어때요?');

            // Test with OpenAI provider
            const openaiContext = conversationService.prepareContext(history);
            const openaiResponse = await conversationService.generateResponse(
                openaiProvider,
                'gpt-4',
                openaiContext
            );

            expect(openaiResponse.content).toBe('Response from openai using gpt-4');
            expect(openaiProvider.lastContext?.messages).toHaveLength(3);
            expect(openaiProvider.lastContext?.messages[0].role).toBe('user');
            expect(openaiProvider.lastContext?.messages[0].content).toBe('안녕하세요');

            // Test with Anthropic provider (same history)
            const anthropicContext = conversationService.prepareContext(history);
            const anthropicResponse = await conversationService.generateResponse(
                anthropicProvider,
                'claude-3-sonnet',
                anthropicContext
            );

            expect(anthropicResponse.content).toBe('Response from anthropic using claude-3-sonnet');
            expect(anthropicProvider.lastContext?.messages).toHaveLength(3);
            expect(anthropicProvider.lastContext?.messages[1].role).toBe('assistant');

            // Test with Google provider (same history)
            const googleContext = conversationService.prepareContext(history);
            const googleResponse = await conversationService.generateResponse(
                googleProvider,
                'gemini-1.5-pro',
                googleContext
            );

            expect(googleResponse.content).toBe('Response from google using gemini-1.5-pro');
            expect(googleProvider.lastContext?.messages).toHaveLength(3);
            expect(googleProvider.lastContext?.messages[2].role).toBe('user');
            expect(googleProvider.lastContext?.messages[2].content).toBe('날씨가 어때요?');
        });

        it('should work with PersistentSystemConversationHistory across different providers', async () => {
            const systemPrompt = 'You are a helpful weather assistant.';
            const history = new PersistentSystemConversationHistory(systemPrompt);

            // Add user message
            history.addUserMessage('오늘 서울 날씨 알려주세요');

            // Test with all providers
            const providers = [
                { provider: openaiProvider, model: 'gpt-4' },
                { provider: anthropicProvider, model: 'claude-3-sonnet' },
                { provider: googleProvider, model: 'gemini-1.5-pro' }
            ];

            for (const { provider, model } of providers) {
                const context = conversationService.prepareContext(history);
                const response = await conversationService.generateResponse(
                    provider,
                    model,
                    context
                );

                expect(response.content).toBe(`Response from ${provider.name} using ${model}`);

                // All providers should receive the same UniversalMessage structure
                expect(provider.lastContext?.messages).toHaveLength(2); // system + user
                expect(provider.lastContext?.messages[0].role).toBe('system');
                expect(provider.lastContext?.messages[0].content).toBe(systemPrompt);
                expect(provider.lastContext?.messages[1].role).toBe('user');
                expect(provider.lastContext?.messages[1].content).toBe('오늘 서울 날씨 알려주세요');
            }
        });

        it('should handle function calls consistently across providers', async () => {
            const history = new SimpleConversationHistory();

            // Add user message
            history.addUserMessage('날씨를 확인해주세요');

            // Add assistant message with function call
            history.addAssistantMessage(
                '날씨를 확인해보겠습니다.',
                {
                    name: 'get_weather',
                    arguments: { location: 'Seoul', unit: 'celsius' }
                }
            );

            // Add tool result
            history.addToolMessage({
                name: 'get_weather',
                result: { weather: 'sunny', temperature: 25, humidity: 60 }
            });

            // Test with all providers
            const providers = [openaiProvider, anthropicProvider, googleProvider];

            for (const provider of providers) {
                const context = conversationService.prepareContext(history);
                await conversationService.generateResponse(provider, 'test-model', context);

                // Verify all providers receive the same message structure
                const messages = provider.lastContext?.messages;
                expect(messages).toHaveLength(3);

                // User message
                expect(messages?.[0].role).toBe('user');
                expect(messages?.[0].content).toBe('날씨를 확인해주세요');

                // Assistant message with function call
                expect(messages?.[1].role).toBe('assistant');
                expect(messages?.[1].content).toBe('날씨를 확인해보겠습니다.');
                expect(messages?.[1].functionCall).toEqual({
                    name: 'get_weather',
                    arguments: { location: 'Seoul', unit: 'celsius' }
                });

                // Tool result message
                expect(messages?.[2].role).toBe('tool');
                expect(messages?.[2].toolResult).toEqual({
                    name: 'get_weather',
                    result: { weather: 'sunny', temperature: 25, humidity: 60 }
                });
            }
        });

        it('should maintain message timestamps across providers', async () => {
            const history = new SimpleConversationHistory();

            history.addUserMessage('테스트 메시지');
            history.addAssistantMessage('응답 메시지');

            const context = conversationService.prepareContext(history);
            await conversationService.generateResponse(openaiProvider, 'test-model', context);

            const messages = openaiProvider.lastContext?.messages;
            expect(messages).toHaveLength(2);

            // Check that timestamps exist
            expect(messages?.[0].timestamp).toBeInstanceOf(Date);
            expect(messages?.[1].timestamp).toBeInstanceOf(Date);
        });
    });

    describe('Provider Independence', () => {
        it('should allow switching between providers without data loss', async () => {
            const history = new SimpleConversationHistory();

            // Build conversation with multiple providers
            history.addUserMessage('첫 번째 질문');

            // Use OpenAI
            let context = conversationService.prepareContext(history);
            await conversationService.generateResponse(openaiProvider, 'gpt-4', context);
            history.addAssistantMessage('OpenAI 응답');

            history.addUserMessage('두 번째 질문');

            // Switch to Anthropic
            context = conversationService.prepareContext(history);
            await conversationService.generateResponse(anthropicProvider, 'claude-3-sonnet', context);
            history.addAssistantMessage('Anthropic 응답');

            history.addUserMessage('세 번째 질문');

            // Switch to Google
            context = conversationService.prepareContext(history);
            await conversationService.generateResponse(googleProvider, 'gemini-1.5-pro', context);

            // Verify Google provider received complete conversation history
            const messages = googleProvider.lastContext?.messages;
            expect(messages).toHaveLength(5);
            expect(messages?.[0].content).toBe('첫 번째 질문');
            expect(messages?.[1].content).toBe('OpenAI 응답');
            expect(messages?.[2].content).toBe('두 번째 질문');
            expect(messages?.[3].content).toBe('Anthropic 응답');
            expect(messages?.[4].content).toBe('세 번째 질문');
        });
    });
}); 