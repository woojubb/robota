import OpenAI from 'openai';
import { UniversalMessage } from '@robota-sdk/core';

/**
 * OpenAI ConversationHistory 어댑터
 * 
 * UniversalMessage를 OpenAI Chat Completions API 형식으로 변환
 */
export class OpenAIConversationAdapter {
    /**
     * UniversalMessage 배열을 OpenAI 메시지 형식으로 변환
     */
    static toOpenAIFormat(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        return messages.map(msg => this.convertMessage(msg));
    }

    /**
     * 단일 UniversalMessage를 OpenAI 형식으로 변환
     */
    static convertMessage(msg: UniversalMessage): OpenAI.Chat.ChatCompletionMessageParam {
        switch (msg.role) {
            case 'user':
                return {
                    role: 'user',
                    content: msg.content,
                    name: msg.name
                };

            case 'assistant':
                if (msg.functionCall) {
                    return {
                        role: 'assistant',
                        content: msg.content || null,
                        function_call: {
                            name: msg.functionCall.name,
                            arguments: typeof msg.functionCall.arguments === 'string'
                                ? msg.functionCall.arguments
                                : JSON.stringify(msg.functionCall.arguments || {})
                        }
                    };
                }
                return {
                    role: 'assistant',
                    content: msg.content
                };

            case 'system':
                return {
                    role: 'system',
                    content: msg.content
                };

            case 'tool':
                // OpenAI에서는 tool 역할을 function으로 변환
                return {
                    role: 'function',
                    name: msg.name || msg.toolResult?.name || 'unknown_tool',
                    content: msg.content
                };

            default:
                // 알 수 없는 역할은 user로 처리
                return {
                    role: 'user',
                    content: msg.content
                };
        }
    }

    /**
     * 시스템 프롬프트를 메시지 배열에 추가 (필요한 경우)
     */
    static addSystemPromptIfNeeded(
        messages: OpenAI.Chat.ChatCompletionMessageParam[],
        systemPrompt?: string
    ): OpenAI.Chat.ChatCompletionMessageParam[] {
        if (!systemPrompt) {
            return messages;
        }

        // 이미 시스템 메시지가 있는지 확인
        const hasSystemMessage = messages.some(msg => msg.role === 'system');

        if (hasSystemMessage) {
            return messages;
        }

        // 시스템 프롬프트를 맨 앞에 추가
        return [
            { role: 'system', content: systemPrompt },
            ...messages
        ];
    }
} 