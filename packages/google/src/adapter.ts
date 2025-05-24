import type { UniversalMessage } from '@robota-sdk/core';

/**
 * Google AI ConversationHistory adapter
 * 
 * Converts UniversalMessage to Google Generative AI format
 */
export class GoogleConversationAdapter {
    /**
     * Convert UniversalMessage array to Google AI message format
     */
    static toGoogleFormat(messages: UniversalMessage[]): any[] {
        return messages
            .filter(msg => msg.role !== 'system') // System messages are handled separately
            .map(msg => this.convertMessage(msg));
    }

    /**
     * Convert a single UniversalMessage to Google AI format
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
                    // Google AI includes function calls in parts
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
                // Convert tool results to function response
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
                // System messages are handled separately, convert to user here
                return {
                    role: 'user',
                    parts: [{ text: `[System]: ${msg.content}` }]
                };

            default:
                // Unknown roles are handled as user
                return {
                    role: 'user',
                    parts: [{ text: msg.content }]
                };
        }
    }

    /**
     * Extract system messages and combine them as system instruction
     */
    static extractSystemInstruction(messages: UniversalMessage[], fallbackSystemPrompt?: string): string | undefined {
        const systemMessages = messages.filter(msg => msg.role === 'system');

        if (systemMessages.length > 0) {
            return systemMessages.map(msg => msg.content).join('\n\n');
        }

        return fallbackSystemPrompt;
    }

    /**
     * Complete message conversion pipeline
     */
    static processMessages(
        messages: UniversalMessage[],
        systemPrompt?: string
    ): {
        contents: any[],
        systemInstruction?: string
    } {
        // 1. Extract system instruction
        const systemInstruction = this.extractSystemInstruction(messages, systemPrompt);

        // 2. Convert messages to Google AI format
        const contents = this.toGoogleFormat(messages);

        return {
            contents,
            systemInstruction
        };
    }
} 