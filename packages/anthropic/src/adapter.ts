import { UniversalMessage } from '@robota-sdk/core';

/**
 * Anthropic ConversationHistory 어댑터
 * 
 * UniversalMessage를 Anthropic prompt 형식으로 변환
 */
export class AnthropicConversationAdapter {
    /**
     * UniversalMessage 배열을 Anthropic prompt 형식으로 변환
     */
    static toAnthropicPrompt(messages: UniversalMessage[], systemPrompt?: string): string {
        let prompt = '';

        // 시스템 프롬프트 추가 (있는 경우)
        const finalSystemPrompt = this.extractSystemPrompt(messages, systemPrompt);
        if (finalSystemPrompt) {
            prompt += finalSystemPrompt + '\n\n';
        }

        // 메시지들을 Human/Assistant 형식으로 변환
        for (const message of messages) {
            if (message.role === 'system') {
                continue; // 시스템 메시지는 이미 처리됨
            }

            if (message.role === 'user') {
                prompt += `\n\nHuman: ${message.content}`;
            } else if (message.role === 'assistant') {
                let content = message.content;

                // Function call이 있는 경우 내용에 포함
                if (message.functionCall) {
                    content += `\n\nFunction Call: ${message.functionCall.name}(${JSON.stringify(message.functionCall.arguments)})`;
                }

                prompt += `\n\nAssistant: ${content}`;
            } else if (message.role === 'tool') {
                // 도구 결과를 Human 메시지로 변환
                prompt += `\n\nHuman: [Tool Result from ${message.name || 'unknown'}]: ${message.content}`;
            }
        }

        // 마지막이 Human 메시지인 경우 Assistant 프롬프트 추가
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            prompt += '\n\nAssistant:';
        }

        return prompt;
    }

    /**
     * 시스템 메시지들을 추출하여 시스템 프롬프트로 결합
     */
    static extractSystemPrompt(messages: UniversalMessage[], fallbackSystemPrompt?: string): string | undefined {
        const systemMessages = messages.filter(msg => msg.role === 'system');

        if (systemMessages.length > 0) {
            return systemMessages.map(msg => msg.content).join('\n\n');
        }

        return fallbackSystemPrompt;
    }

    /**
     * 메시지 변환 테스트용 헬퍼 (각 메시지를 개별적으로 변환)
     */
    static convertMessage(msg: UniversalMessage): { role: string; content: string } {
        switch (msg.role) {
            case 'user':
                return {
                    role: 'human',
                    content: msg.content
                };

            case 'assistant':
                let content = msg.content;
                if (msg.functionCall) {
                    content += `\n\nFunction Call: ${msg.functionCall.name}(${JSON.stringify(msg.functionCall.arguments)})`;
                }
                return {
                    role: 'assistant',
                    content
                };

            case 'tool':
                return {
                    role: 'human',
                    content: `[Tool Result from ${msg.name || 'unknown'}]: ${msg.content}`
                };

            case 'system':
                return {
                    role: 'system',
                    content: msg.content
                };

            default:
                return {
                    role: 'human',
                    content: msg.content
                };
        }
    }
} 