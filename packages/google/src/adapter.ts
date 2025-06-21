import type { UniversalMessage, UserMessage, AssistantMessage, SystemMessage, ToolMessage } from '@robota-sdk/agents';
import type { Content, Part } from '@google/generative-ai';

/**
 * Google AI ConversationHistory adapter
 * 
 * Converts UniversalMessage to Google Generative AI format
 */
export class GoogleConversationAdapter {
    /**
     * Convert UniversalMessage array to Google AI message format
     */
    static toGoogleFormat(messages: UniversalMessage[]): Content[] {
        return messages
            .filter(msg => msg.role !== 'system') // System messages are handled separately
            .map(msg => this.convertMessage(msg));
    }

    /**
     * Convert a single UniversalMessage to Google AI format
     */
    static convertMessage(msg: UniversalMessage): Content {
        const messageRole = msg.role;

        // Handle user messages
        if (messageRole === 'user') {
            const userMsg = msg as UserMessage;
            return {
                role: 'user',
                parts: [{ text: userMsg.content }]
            };
        }

        // Handle assistant messages
        if (messageRole === 'assistant') {
            const assistantMsg = msg as AssistantMessage;
            if ((assistantMsg as any).toolCalls) {
                const parts: Part[] = [{ text: assistantMsg.content || '' }];

                // Add tool calls if they exist
                const toolCalls = (assistantMsg as any).toolCalls;
                for (const tc of toolCalls) {
                    parts.push({
                        functionCall: {
                            name: tc.function.name,
                            args: JSON.parse(tc.function.arguments)
                        }
                    } as Part);
                }

                return {
                    role: 'model',
                    parts
                };
            }
            return {
                role: 'model',
                parts: [{ text: assistantMsg.content || '' }]
            };
        }

        // Handle tool messages
        if (messageRole === 'tool') {
            const toolMsg = msg as ToolMessage;
            return {
                role: 'function',
                parts: [
                    {
                        functionResponse: {
                            name: 'tool_response',
                            response: toolMsg.content
                        }
                    } as any
                ]
            };
        }

        // Handle system messages (convert to user)
        if (messageRole === 'system') {
            const systemMsg = msg as SystemMessage;
            return {
                role: 'user',
                parts: [{ text: `[System]: ${systemMsg.content}` }]
            };
        }

        // This should never happen but TypeScript requires exhaustive checking
        const _exhaustiveCheck: never = msg;
        return _exhaustiveCheck;
    }

    /**
     * Extract system messages and combine them as system instruction
     */
    static extractSystemInstruction(messages: UniversalMessage[], fallbackSystemPrompt?: string): string | undefined {
        const systemMessages = messages.filter(msg => msg.role === 'system') as SystemMessage[];

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
        contents: Content[],
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