import { describe, it, expect } from 'vitest';
import { OpenAIConversationAdapter } from './adapter';
import { UniversalMessage } from '@robota-sdk/core';

describe('OpenAIConversationAdapter', () => {
    it('should convert user message correctly', () => {
        const userMessage: UniversalMessage = {
            role: 'user',
            content: 'Hello',
            timestamp: new Date(),
            name: 'testuser'
        };

        const result = OpenAIConversationAdapter.convertMessage(userMessage);

        expect(result).toEqual({
            role: 'user',
            content: 'Hello',
            name: 'testuser'
        });
    });

    it('should convert assistant message correctly', () => {
        const assistantMessage: UniversalMessage = {
            role: 'assistant',
            content: 'Hello! How can I help you?',
            timestamp: new Date()
        };

        const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

        expect(result).toEqual({
            role: 'assistant',
            content: 'Hello! How can I help you?'
        });
    });

    it('should convert assistant message with function call correctly', () => {
        const assistantMessageWithFunction: UniversalMessage = {
            role: 'assistant',
            content: 'I will check the weather for you.',
            functionCall: {
                name: 'get_weather',
                arguments: { location: 'Seoul' }
            },
            timestamp: new Date()
        };

        const result = OpenAIConversationAdapter.convertMessage(assistantMessageWithFunction);

        expect(result).toEqual({
            role: 'assistant',
            content: 'I will check the weather for you.',
            function_call: {
                name: 'get_weather',
                arguments: JSON.stringify({ location: 'Seoul' })
            }
        });
    });

    it('should convert system message correctly', () => {
        const systemMessage: UniversalMessage = {
            role: 'system',
            content: 'You are a helpful assistant.',
            timestamp: new Date()
        };

        const result = OpenAIConversationAdapter.convertMessage(systemMessage);

        expect(result).toEqual({
            role: 'system',
            content: 'You are a helpful assistant.'
        });
    });

    it('should filter out tool messages in toOpenAIFormat', () => {
        const messages: UniversalMessage[] = [
            {
                role: 'user',
                content: 'What is the weather?',
                timestamp: new Date()
            },
            {
                role: 'tool',
                content: 'Weather: Sunny, 25°C',
                name: 'get_weather',
                toolResult: {
                    name: 'get_weather',
                    result: { weather: 'sunny', temperature: 25 }
                },
                timestamp: new Date()
            },
            {
                role: 'assistant',
                content: 'The weather is sunny and 25°C.',
                timestamp: new Date()
            }
        ];

        const result = OpenAIConversationAdapter.toOpenAIFormat(messages);

        // Tool message should be filtered out
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            role: 'user',
            content: 'What is the weather?',
            name: undefined
        });
        expect(result[1]).toEqual({
            role: 'assistant',
            content: 'The weather is sunny and 25°C.'
        });
    });

    it('should convert multiple messages correctly', () => {
        const messages: UniversalMessage[] = [
            {
                role: 'system',
                content: 'You are a helpful assistant.',
                timestamp: new Date()
            },
            {
                role: 'user',
                content: 'Hello',
                timestamp: new Date()
            },
            {
                role: 'assistant',
                content: 'Hello! How can I help you?',
                timestamp: new Date()
            }
        ];

        const result = OpenAIConversationAdapter.toOpenAIFormat(messages);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({
            role: 'system',
            content: 'You are a helpful assistant.'
        });
        expect(result[1]).toEqual({
            role: 'user',
            content: 'Hello',
            name: undefined
        });
        expect(result[2]).toEqual({
            role: 'assistant',
            content: 'Hello! How can I help you?'
        });
    });

    it('should add system prompt if needed', () => {
        const messages = [
            { role: 'user' as const, content: 'Hello' }
        ];

        const result = OpenAIConversationAdapter.addSystemPromptIfNeeded(
            messages,
            'You are a helpful assistant.'
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            role: 'system',
            content: 'You are a helpful assistant.'
        });
        expect(result[1]).toEqual({
            role: 'user',
            content: 'Hello'
        });
    });

    it('should not add system prompt if already exists', () => {
        const messages = [
            { role: 'system' as const, content: 'Existing system message' },
            { role: 'user' as const, content: 'Hello' }
        ];

        const result = OpenAIConversationAdapter.addSystemPromptIfNeeded(
            messages,
            'You are a helpful assistant.'
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            role: 'system',
            content: 'Existing system message'
        });
    });
}); 