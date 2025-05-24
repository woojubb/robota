import { describe, it, expect } from 'vitest';
import { OpenAIConversationAdapter } from './adapter';
import { UniversalMessage } from '@robota-sdk/core';

describe('OpenAIConversationAdapter', () => {
    it('should convert user message correctly', () => {
        const userMessage: UniversalMessage = {
            role: 'user',
            content: '안녕하세요',
            timestamp: new Date(),
            name: 'testuser'
        };

        const result = OpenAIConversationAdapter.convertMessage(userMessage);

        expect(result).toEqual({
            role: 'user',
            content: '안녕하세요',
            name: 'testuser'
        });
    });

    it('should convert assistant message correctly', () => {
        const assistantMessage: UniversalMessage = {
            role: 'assistant',
            content: '안녕하세요! 무엇을 도와드릴까요?',
            timestamp: new Date()
        };

        const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

        expect(result).toEqual({
            role: 'assistant',
            content: '안녕하세요! 무엇을 도와드릴까요?'
        });
    });

    it('should convert assistant message with function call correctly', () => {
        const assistantMessageWithFunction: UniversalMessage = {
            role: 'assistant',
            content: '날씨를 확인해보겠습니다.',
            functionCall: {
                name: 'get_weather',
                arguments: { location: 'Seoul' }
            },
            timestamp: new Date()
        };

        const result = OpenAIConversationAdapter.convertMessage(assistantMessageWithFunction);

        expect(result).toEqual({
            role: 'assistant',
            content: '날씨를 확인해보겠습니다.',
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

    it('should convert tool message correctly', () => {
        const toolMessage: UniversalMessage = {
            role: 'tool',
            content: 'Weather: Sunny, 25°C',
            name: 'get_weather',
            toolResult: {
                name: 'get_weather',
                result: { weather: 'sunny', temperature: 25 }
            },
            timestamp: new Date()
        };

        const result = OpenAIConversationAdapter.convertMessage(toolMessage);

        expect(result).toEqual({
            role: 'function',
            name: 'get_weather',
            content: 'Weather: Sunny, 25°C'
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
                content: '안녕하세요',
                timestamp: new Date()
            },
            {
                role: 'assistant',
                content: '안녕하세요! 무엇을 도와드릴까요?',
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
            content: '안녕하세요',
            name: undefined
        });
        expect(result[2]).toEqual({
            role: 'assistant',
            content: '안녕하세요! 무엇을 도와드릴까요?'
        });
    });

    it('should add system prompt if needed', () => {
        const messages = [
            { role: 'user' as const, content: '안녕하세요' }
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
            content: '안녕하세요'
        });
    });

    it('should not add system prompt if already exists', () => {
        const messages = [
            { role: 'system' as const, content: 'Existing system message' },
            { role: 'user' as const, content: '안녕하세요' }
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