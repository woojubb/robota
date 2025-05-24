import type { UniversalMessage } from '@robota-sdk/core';

/**
 * Google AI ConversationHistory 어댑터
 * 
 * UniversalMessage를 Google Generative AI 형식으로 변환
 */
export class GoogleConversationAdapter {
    /**
     * UniversalMessage 배열을 Google AI 메시지 형식으로 변환
     */
    static toGoogleFormat(messages: UniversalMessage[]): any[] {
        return messages
            .filter(msg => msg.role !== 'system') // 시스템 메시지는 별도 처리
            .map(msg => this.convertMessage(msg));
    }

    /**
     * 단일 UniversalMessage를 Google AI 형식으로 변환
     */
    static convertMessage(msg: UniversalMessage): any {
        switch (msg.role) {
            case 'user':
                return {
                    role: 'user',
                    parts: [{ text: msg.content }]
                };

            case 'assistant':
                if (msg.functionCall) {
                    // Google AI에서는 function call을 parts에 포함
                    return {
                        role: 'model',
                        parts: [
                            { text: msg.content },
                            {
                                functionCall: {
                                    name: msg.functionCall.name,
                                    args: msg.functionCall.arguments
                                }
                            }
                        ]
                    };
                }
                return {
                    role: 'model',
                    parts: [{ text: msg.content }]
                };

            case 'tool':
                // 도구 결과를 function response로 변환
                return {
                    role: 'function',
                    parts: [
                        {
                            functionResponse: {
                                name: msg.name || msg.toolResult?.name || 'unknown_tool',
                                response: msg.toolResult?.result || msg.content
                            }
                        }
                    ]
                };

            case 'system':
                // 시스템 메시지는 별도 처리되므로 여기서는 user로 변환
                return {
                    role: 'user',
                    parts: [{ text: `[System]: ${msg.content}` }]
                };

            default:
                // 알 수 없는 역할은 user로 처리
                return {
                    role: 'user',
                    parts: [{ text: msg.content }]
                };
        }
    }

    /**
     * 시스템 메시지들을 추출하여 시스템 instruction으로 결합
     */
    static extractSystemInstruction(messages: UniversalMessage[], fallbackSystemPrompt?: string): string | undefined {
        const systemMessages = messages.filter(msg => msg.role === 'system');

        if (systemMessages.length > 0) {
            return systemMessages.map(msg => msg.content).join('\n\n');
        }

        return fallbackSystemPrompt;
    }

    /**
     * 완전한 메시지 변환 파이프라인
     */
    static processMessages(
        messages: UniversalMessage[],
        systemPrompt?: string
    ): {
        contents: any[],
        systemInstruction?: string
    } {
        // 1. 시스템 instruction 추출
        const systemInstruction = this.extractSystemInstruction(messages, systemPrompt);

        // 2. 메시지를 Google AI 형식으로 변환
        const contents = this.toGoogleFormat(messages);

        return {
            contents,
            systemInstruction
        };
    }
} 