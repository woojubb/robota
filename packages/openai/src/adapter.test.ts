import { describe, it, expect } from 'vitest';
import { OpenAIConversationAdapter } from './adapter';
import type {
    UniversalMessage,
    ToolCall
} from './provider';

// Define message types locally for testing
type UserMessage = {
    role: 'user';
    content: string | null;
    timestamp?: Date;
};

type AssistantMessage = {
    role: 'assistant';
    content: string | null;
    timestamp?: Date;
    toolCalls?: ToolCall[];
};

type SystemMessage = {
    role: 'system';
    content: string | null;
    timestamp?: Date;
};

type ToolMessage = {
    role: 'tool';
    content: string | null;
    timestamp?: Date;
    toolCallId?: string;
    name?: string;
};

describe('OpenAIConversationAdapter', () => {
    describe('convertMessage', () => {
        it('should convert user message correctly', () => {
            const userMessage: UserMessage = {
                role: 'user',
                content: 'Hello, how are you?',
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(userMessage);

            expect(result).toEqual({
                role: 'user',
                content: 'Hello, how are you?'
            });
        });

        it('should convert system message correctly', () => {
            const systemMessage: SystemMessage = {
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

        it('should convert regular assistant message with content correctly', () => {
            const assistantMessage: AssistantMessage = {
                role: 'assistant',
                content: 'I can help you with that.',
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

            expect(result).toEqual({
                role: 'assistant',
                content: 'I can help you with that.'
            });
        });

        it('should convert assistant message with null content correctly', () => {
            const assistantMessage: AssistantMessage = {
                role: 'assistant',
                content: null,
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

            expect(result).toEqual({
                role: 'assistant',
                content: null
            });
        });

        it('should convert assistant message with empty content correctly', () => {
            const assistantMessage: AssistantMessage = {
                role: 'assistant',
                content: '',
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

            expect(result).toEqual({
                role: 'assistant',
                content: null  // Empty string is also converted to null
            });
        });

        it('should convert assistant message with tool calls and null content correctly', () => {
            const assistantMessage: AssistantMessage = {
                role: 'assistant',
                content: null,
                toolCalls: [
                    {
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"operation":"add","a":5,"b":3}'
                        }
                    }
                ],
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

            expect(result).toEqual({
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"operation":"add","a":5,"b":3}'
                        }
                    }
                ]
            });
        });

        it('should convert assistant message with tool calls and empty content correctly', () => {
            const assistantMessage: AssistantMessage = {
                role: 'assistant',
                content: '',
                toolCalls: [
                    {
                        id: 'call_456',
                        type: 'function',
                        function: {
                            name: 'getWeather',
                            arguments: '{"city":"Seoul"}'
                        }
                    }
                ],
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

            expect(result).toEqual({
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_456',
                        type: 'function',
                        function: {
                            name: 'getWeather',
                            arguments: '{"city":"Seoul"}'
                        }
                    }
                ]
            });
        });

        it('should convert assistant message with tool calls and meaningful content correctly', () => {
            const assistantMessage: AssistantMessage = {
                role: 'assistant',
                content: 'Let me calculate that for you.',
                toolCalls: [
                    {
                        id: 'call_789',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"operation":"multiply","a":7,"b":8}'
                        }
                    }
                ],
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(assistantMessage);

            expect(result).toEqual({
                role: 'assistant',
                content: 'Let me calculate that for you.',
                tool_calls: [
                    {
                        id: 'call_789',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"operation":"multiply","a":7,"b":8}'
                        }
                    }
                ]
            });
        });

        it('should convert tool message correctly', () => {
            const toolMessage: ToolMessage = {
                role: 'tool',
                content: '{"result":8,"operation":"5 + 3 = 8"}',
                toolCallId: 'call_123',
                name: 'calculate',
                timestamp: new Date()
            };

            const result = OpenAIConversationAdapter.convertMessage(toolMessage);

            expect(result).toEqual({
                role: 'tool',
                content: '{"result":8,"operation":"5 + 3 = 8"}',
                tool_call_id: 'call_123'
            });
        });

        it('should throw error for tool message without toolCallId', () => {
            const toolMessage: ToolMessage = {
                role: 'tool',
                content: '{"result":8}',
                toolCallId: '',
                timestamp: new Date()
            };

            expect(() => {
                OpenAIConversationAdapter.convertMessage(toolMessage);
            }).toThrow('Tool message missing toolCallId');
        });
    });

    describe('toOpenAIFormat', () => {
        it('should convert a complete conversation with tool calls correctly', () => {
            const messages: UniversalMessage[] = [
                {
                    role: 'system',
                    content: 'You are a helpful assistant.',
                    timestamp: new Date()
                },
                {
                    role: 'user',
                    content: 'What is 5 plus 3?',
                    timestamp: new Date()
                },
                {
                    role: 'assistant',
                    content: null,
                    toolCalls: [
                        {
                            id: 'call_123',
                            type: 'function',
                            function: {
                                name: 'calculate',
                                arguments: '{"operation":"add","a":5,"b":3}'
                            }
                        }
                    ],
                    timestamp: new Date()
                },
                {
                    role: 'tool',
                    content: '{"result":8,"operation":"5 + 3 = 8"}',
                    toolCallId: 'call_123',
                    name: 'calculate',
                    timestamp: new Date()
                },
                {
                    role: 'assistant',
                    content: 'The result of 5 plus 3 is 8.',
                    timestamp: new Date()
                }
            ];

            const result = OpenAIConversationAdapter.toOpenAIFormat(messages);

            expect(result).toEqual([
                {
                    role: 'system',
                    content: 'You are a helpful assistant.'
                },
                {
                    role: 'user',
                    content: 'What is 5 plus 3?'
                },
                {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                        {
                            id: 'call_123',
                            type: 'function',
                            function: {
                                name: 'calculate',
                                arguments: '{"operation":"add","a":5,"b":3}'
                            }
                        }
                    ]
                },
                {
                    role: 'tool',
                    content: '{"result":8,"operation":"5 + 3 = 8"}',
                    tool_call_id: 'call_123'
                },
                {
                    role: 'assistant',
                    content: 'The result of 5 plus 3 is 8.'
                }
            ]);
        });

        it('should filter out tool messages with invalid toolCallId', () => {
            const messages: UniversalMessage[] = [
                {
                    role: 'user',
                    content: 'Hello',
                    timestamp: new Date()
                },
                {
                    role: 'tool',
                    content: 'Invalid tool message',
                    toolCallId: '',
                    timestamp: new Date()
                },
                {
                    role: 'tool',
                    content: 'Another invalid tool message',
                    toolCallId: 'unknown',
                    timestamp: new Date()
                },
                {
                    role: 'assistant',
                    content: 'Hi there!',
                    timestamp: new Date()
                }
            ];

            const result = OpenAIConversationAdapter.toOpenAIFormat(messages);

            expect(result).toEqual([
                {
                    role: 'user',
                    content: 'Hello'
                },
                {
                    role: 'assistant',
                    content: 'Hi there!'
                }
            ]);
        });

        it('should handle the tool execution loop prevention scenario correctly', () => {
            const messages: UniversalMessage[] = [
                {
                    role: 'system',
                    content: 'You are a helpful assistant.',
                    timestamp: new Date()
                },
                {
                    role: 'user',
                    content: 'What is 5 plus 3?',
                    timestamp: new Date()
                },
                {
                    role: 'assistant',
                    content: null,
                    toolCalls: [
                        {
                            id: 'call_calculate_123',
                            type: 'function',
                            function: {
                                name: 'calculate',
                                arguments: '{"operation":"add","a":5,"b":3}'
                            }
                        }
                    ],
                    timestamp: new Date()
                },
                {
                    role: 'tool',
                    content: '{"result":8,"operation":"5 + 3 = 8"}',
                    toolCallId: 'call_calculate_123',
                    name: 'calculate',
                    timestamp: new Date()
                }
            ];

            const result = OpenAIConversationAdapter.toOpenAIFormat(messages);

            expect(result[2]).toEqual({
                role: 'assistant',
                content: null,
                tool_calls: [
                    {
                        id: 'call_calculate_123',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"operation":"add","a":5,"b":3}'
                        }
                    }
                ]
            });

            expect(result[3]).toEqual({
                role: 'tool',
                content: '{"result":8,"operation":"5 + 3 = 8"}',
                tool_call_id: 'call_calculate_123'
            });
        });

        it('should demonstrate the difference between correct and incorrect content handling', () => {
            const correctAssistantMessage: AssistantMessage = {
                role: 'assistant',
                content: null,
                toolCalls: [
                    {
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"a":5,"b":3}'
                        }
                    }
                ],
                timestamp: new Date()
            };

            const incorrectAssistantMessage: AssistantMessage = {
                role: 'assistant',
                content: '',
                toolCalls: [
                    {
                        id: 'call_123',
                        type: 'function',
                        function: {
                            name: 'calculate',
                            arguments: '{"a":5,"b":3}'
                        }
                    }
                ],
                timestamp: new Date()
            };

            const correctResult = OpenAIConversationAdapter.convertMessage(correctAssistantMessage);
            const incorrectResult = OpenAIConversationAdapter.convertMessage(incorrectAssistantMessage);

            expect(correctResult.content).toBe(null);
            expect(incorrectResult.content).toBe(null);
        });
    });
}); 