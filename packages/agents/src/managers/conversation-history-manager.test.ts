import { describe, it, expect } from 'vitest';
import {
    ConversationSession,
    ConversationHistory,
    isToolMessage,
    isAssistantMessage,
    createAssistantMessage,
    createToolMessage,
    createUserMessage,
    createSystemMessage
} from './conversation-history-manager';
import type { ToolMessage } from './conversation-history-manager';

describe('ConversationSession', () => {
    describe('addToolMessageWithId', () => {
        it('should add tool message successfully with unique toolCallId', () => {
            const session = new ConversationSession();

            session.addToolMessageWithId(
                'Tool result content',
                'tool-call-1',
                'testTool',
                { success: true }
            );

            const messages = session.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('tool');
            expect(messages[0].content).toBe('Tool result content');
            expect(isToolMessage(messages[0]) && messages[0].toolCallId).toBe('tool-call-1');
        });

        it('should throw error when adding tool message with duplicate toolCallId', () => {
            const session = new ConversationSession();

            // Add first tool message
            session.addToolMessageWithId(
                'First tool result',
                'tool-call-1',
                'testTool',
                { success: true }
            );

            // Attempt to add second tool message with same toolCallId
            expect(() => {
                session.addToolMessageWithId(
                    'Second tool result',
                    'tool-call-1', // Same toolCallId
                    'testTool',
                    { success: true }
                );
            }).toThrow('Duplicate tool message detected for toolCallId: tool-call-1');

            // Verify only one message was added
            const messages = session.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].content).toBe('First tool result');
        });

        it('should allow different toolCallIds', () => {
            const session = new ConversationSession();

            session.addToolMessageWithId(
                'First tool result',
                'tool-call-1',
                'testTool',
                { success: true }
            );

            session.addToolMessageWithId(
                'Second tool result',
                'tool-call-2', // Different toolCallId
                'testTool',
                { success: true }
            );

            const messages = session.getMessages();
            expect(messages).toHaveLength(2);
            expect(isToolMessage(messages[0]) && messages[0].toolCallId).toBe('tool-call-1');
            expect(isToolMessage(messages[1]) && messages[1].toolCallId).toBe('tool-call-2');
        });

        it('should maintain proper message order', () => {
            const session = new ConversationSession();

            session.addUserMessage('User input');
            session.addAssistantMessage('Assistant response', [
                { id: 'tool-call-1', type: 'function', function: { name: 'testTool', arguments: '{}' } }
            ]);
            session.addToolMessageWithId('Tool result', 'tool-call-1', 'testTool');

            const messages = session.getMessages();
            expect(messages).toHaveLength(3);
            expect(messages[0].role).toBe('user');
            expect(messages[1].role).toBe('assistant');
            expect(messages[2].role).toBe('tool');
        });
    });

    describe('High-level API data integrity', () => {
        it('should preserve assistant message with null content and tool calls', () => {
            const session = new ConversationSession();

            // Add user message
            session.addUserMessage('What is 5 plus 3?');

            // Add assistant message with null content and tool calls (simulating OpenAI API response)
            session.addAssistantMessage(null, [
                {
                    id: 'call_calculate_123',
                    type: 'function',
                    function: {
                        name: 'calculate',
                        arguments: '{"operation":"add","a":5,"b":3}'
                    }
                }
            ]);

            // Add tool result
            session.addToolMessage(
                '{"result":8,"operation":"5 + 3 = 8"}',
                'call_calculate_123',
                'calculate'
            );

            const messages = session.getMessages();
            expect(messages).toHaveLength(3);

            // Verify user message
            expect(messages[0].role).toBe('user');
            expect(messages[0].content).toBe('What is 5 plus 3?');

            // Verify assistant message with null content is preserved
            expect(messages[1].role).toBe('assistant');
            expect(messages[1].content).toBe(null); // Critical: null should be preserved, not converted to empty string
            expect(isAssistantMessage(messages[1]) && messages[1].toolCalls).toHaveLength(1);
            expect(isAssistantMessage(messages[1]) && messages[1].toolCalls?.[0].id).toBe('call_calculate_123');

            // Verify tool message
            expect(messages[2].role).toBe('tool');
            expect(messages[2].content).toBe('{"result":8,"operation":"5 + 3 = 8"}');
            expect(isToolMessage(messages[2]) && messages[2].toolCallId).toBe('call_calculate_123');
        });

        it('should preserve assistant message with empty string content and tool calls', () => {
            const session = new ConversationSession();

            // Add assistant message with empty content and tool calls
            session.addAssistantMessage('', [
                {
                    id: 'call_weather_456',
                    type: 'function',
                    function: {
                        name: 'getWeather',
                        arguments: '{"city":"Seoul"}'
                    }
                }
            ]);

            const messages = session.getMessages();
            expect(messages).toHaveLength(1);

            const assistantMessage = messages[0];
            expect(assistantMessage.role).toBe('assistant');
            expect(assistantMessage.content).toBe(''); // Empty string should be preserved as-is
            expect(isAssistantMessage(assistantMessage) && assistantMessage.toolCalls).toHaveLength(1);
        });

        it('should preserve assistant message with meaningful content and tool calls', () => {
            const session = new ConversationSession();

            session.addAssistantMessage('Let me calculate that for you.', [
                {
                    id: 'call_789',
                    type: 'function',
                    function: {
                        name: 'calculate',
                        arguments: '{"operation":"multiply","a":7,"b":8}'
                    }
                }
            ]);

            const messages = session.getMessages();
            expect(messages).toHaveLength(1);

            const assistantMessage = messages[0];
            expect(assistantMessage.role).toBe('assistant');
            expect(assistantMessage.content).toBe('Let me calculate that for you.');
            expect(isAssistantMessage(assistantMessage) && assistantMessage.toolCalls).toHaveLength(1);
            expect(isAssistantMessage(assistantMessage) && assistantMessage.toolCalls?.[0].function.name).toBe('calculate');
        });

        it('should handle complete tool execution conversation flow', () => {
            const session = new ConversationSession();

            // Step 1: User asks question
            session.addUserMessage('Calculate 15 * 24');

            // Step 2: Assistant responds with tool call (null content)
            session.addAssistantMessage(null, [
                {
                    id: 'call_multiply_001',
                    type: 'function',
                    function: {
                        name: 'calculate',
                        arguments: '{"operation":"multiply","a":15,"b":24}'
                    }
                }
            ]);

            // Step 3: Tool returns result
            session.addToolMessage(
                '{"result":360,"operation":"15 * 24 = 360"}',
                'call_multiply_001',
                'calculate'
            );

            // Step 4: Assistant provides final response
            session.addAssistantMessage('The result of 15 * 24 is 360.');

            const messages = session.getMessages();
            expect(messages).toHaveLength(4);

            // Validate the complete flow
            expect(messages[0].role).toBe('user');
            expect(messages[1].role).toBe('assistant');
            expect(messages[1].content).toBe(null); // Tool call assistant message should have null content
            expect(messages[2].role).toBe('tool');
            expect(messages[3].role).toBe('assistant');
            expect(messages[3].content).toBe('The result of 15 * 24 is 360.');

            // Verify tool call data integrity
            expect(isAssistantMessage(messages[1]) && messages[1].toolCalls?.[0].id).toBe('call_multiply_001');
            expect(isToolMessage(messages[2]) && messages[2].toolCallId).toBe('call_multiply_001');
        });

        it('should handle multiple tool calls in single assistant message', () => {
            const session = new ConversationSession();

            session.addAssistantMessage(null, [
                {
                    id: 'call_weather_001',
                    type: 'function',
                    function: {
                        name: 'getWeather',
                        arguments: '{"city":"Seoul"}'
                    }
                },
                {
                    id: 'call_weather_002',
                    type: 'function',
                    function: {
                        name: 'getWeather',
                        arguments: '{"city":"Tokyo"}'
                    }
                }
            ]);

            session.addToolMessage('{"weather":"Sunny, 25°C"}', 'call_weather_001', 'getWeather');
            session.addToolMessage('{"weather":"Cloudy, 18°C"}', 'call_weather_002', 'getWeather');

            const messages = session.getMessages();
            expect(messages).toHaveLength(3);

            // Verify assistant message has multiple tool calls
            expect(isAssistantMessage(messages[0]) && messages[0].toolCalls).toHaveLength(2);
            expect(isAssistantMessage(messages[0]) && messages[0].content).toBe(null);

            // Verify tool messages are correctly linked
            expect(isToolMessage(messages[1]) && messages[1].toolCallId).toBe('call_weather_001');
            expect(isToolMessage(messages[2]) && messages[2].toolCallId).toBe('call_weather_002');
        });

        it('should preserve metadata for all message types', () => {
            const session = new ConversationSession();

            const userMetadata = { userId: 'user123', timestamp: '2024-01-01' };
            const assistantMetadata = { model: 'gpt-4', provider: 'openai' };
            const toolMetadata = { executionTime: 150, success: true };

            session.addUserMessage('Test message', userMetadata);
            session.addAssistantMessage('Response', [], assistantMetadata);
            session.addToolMessage('Tool result', 'call_123', 'testTool', toolMetadata);

            const messages = session.getMessages();

            expect(messages[0].metadata).toEqual(userMetadata);
            expect(messages[1].metadata).toEqual(assistantMetadata);
            expect(messages[2].metadata).toEqual(toolMetadata);
        });
    });

    describe('Factory functions data integrity', () => {
        it('should create assistant message with null content correctly', () => {
            const message = createAssistantMessage(null, [
                {
                    id: 'call_123',
                    type: 'function',
                    function: { name: 'test', arguments: '{}' }
                }
            ]);

            expect(message.role).toBe('assistant');
            expect(message.content).toBe(null);
            expect(message.toolCalls).toHaveLength(1);
            expect(message.timestamp).toBeInstanceOf(Date);
        });

        it('should create tool message with all required fields', () => {
            const message = createToolMessage(
                '{"result": "success"}',
                'call_123',
                'testTool',
                { success: true }
            );

            expect(message.role).toBe('tool');
            expect(message.content).toBe('{"result": "success"}');
            expect(message.toolCallId).toBe('call_123');
            expect(message.name).toBe('testTool');
            expect(message.metadata).toEqual({ success: true });
            expect(message.timestamp).toBeInstanceOf(Date);
        });
    });
});

describe('ConversationHistory', () => {
    describe('High-level conversation management', () => {
        it('should maintain conversation integrity across sessions', () => {
            const history = new ConversationHistory();

            const sessionA = history.getConversationSession('conversation-a');
            const sessionB = history.getConversationSession('conversation-b');

            // Add messages to different sessions
            sessionA.addUserMessage('Hello from A');
            sessionA.addAssistantMessage(null, [
                { id: 'call_a_1', type: 'function', function: { name: 'toolA', arguments: '{}' } }
            ]);

            sessionB.addUserMessage('Hello from B');
            sessionB.addAssistantMessage('Response from B');

            // Verify session isolation
            expect(sessionA.getMessages()).toHaveLength(2);
            expect(sessionB.getMessages()).toHaveLength(2);

            // Verify content integrity
            expect(sessionA.getMessages()[0].content).toBe('Hello from A');
            expect(sessionA.getMessages()[1].content).toBe(null);
            expect(sessionB.getMessages()[0].content).toBe('Hello from B');
            expect(sessionB.getMessages()[1].content).toBe('Response from B');
        });

        it('should provide accurate statistics', () => {
            const history = new ConversationHistory();

            const session1 = history.getConversationSession('conv1');
            const session2 = history.getConversationSession('conv2');

            session1.addUserMessage('Message 1');
            session1.addAssistantMessage('Response 1');
            session2.addUserMessage('Message 2');

            const stats = history.getStats();
            expect(stats.totalConversations).toBe(2);
            expect(stats.totalMessages).toBe(3);
            expect(stats.conversationIds).toContain('conv1');
            expect(stats.conversationIds).toContain('conv2');
        });
    });

    describe('Tool execution loop prevention integration test', () => {
        it('should prevent infinite tool execution by preserving conversation history correctly', () => {
            // This test simulates the exact scenario that was causing infinite tool execution
            const session = new ConversationSession();

            // Simulate the conversation flow that was causing the issue:

            // Turn 1: User asks for calculation
            session.addUserMessage('What is 5 plus 3?');

            // Turn 2: AI decides to use calculator tool
            // This is the critical point - OpenAI API returns content: null when making tool calls
            session.addAssistantMessage(null, [
                {
                    id: 'call_calculate_abc123',
                    type: 'function',
                    function: {
                        name: 'calculate',
                        arguments: '{"operation":"add","a":5,"b":3}'
                    }
                }
            ]);

            // Turn 3: Tool executes and returns result
            session.addToolMessage(
                '{"result":8,"operation":"5 + 3 = 8"}',
                'call_calculate_abc123',
                'calculate'
            );

            // Turn 4: AI provides final answer
            session.addAssistantMessage('The result of 5 plus 3 is 8.');

            // Now simulate what would happen if we send this conversation back to AI
            const messages = session.getMessages();
            expect(messages).toHaveLength(4);

            // The key test: AI should be able to see that it already made a tool call
            // by looking at the assistant message with null content and tool_calls
            const assistantToolCallMessage = messages[1];
            expect(assistantToolCallMessage.role).toBe('assistant');
            expect(assistantToolCallMessage.content).toBe(null); // This is critical!
            expect(isAssistantMessage(assistantToolCallMessage) && assistantToolCallMessage.toolCalls).toHaveLength(1);

            // The tool result should be properly linked
            const toolResultMessage = messages[2];
            expect(toolResultMessage.role).toBe('tool');
            expect(isToolMessage(toolResultMessage) && toolResultMessage.toolCallId).toBe('call_calculate_abc123');

            // If this conversation history is sent back to AI, it should NOT call the tool again
            // because it can see the tool was already called and the result was provided
        });

        it('should demonstrate the infinite loop scenario that was happening before the fix', () => {
            // This test documents what was happening before we fixed the content handling
            const session = new ConversationSession();

            session.addUserMessage('What is 5 plus 3?');

            // BEFORE FIX: We were incorrectly storing empty string instead of null
            // This made the AI think no tool call was made, causing it to call the tool again
            const incorrectAssistantMessage = createAssistantMessage('', [
                {
                    id: 'call_calculate_xyz789',
                    type: 'function',
                    function: {
                        name: 'calculate',
                        arguments: '{"operation":"add","a":5,"b":3}'
                    }
                }
            ]);

            // AFTER FIX: We now correctly store null content
            const correctAssistantMessage = createAssistantMessage(null, [
                {
                    id: 'call_calculate_xyz789',
                    type: 'function',
                    function: {
                        name: 'calculate',
                        arguments: '{"operation":"add","a":5,"b":3}'
                    }
                }
            ]);

            // Both messages have tool calls, but content differs
            expect(incorrectAssistantMessage.content).toBe('');  // This was causing the problem
            expect(correctAssistantMessage.content).toBe(null); // This is the correct way

            // When converted by OpenAI adapter, both should become content: null
            // But in conversation history, we need to preserve the original null from API
            expect(correctAssistantMessage.content).toBe(null);
        });

        it('should handle edge case of assistant message with both content and tool calls', () => {
            // Some AI models might return both content and tool calls
            const session = new ConversationSession();

            session.addUserMessage('Calculate 10 * 5 and explain the process');

            // Assistant message with both explanation and tool call
            session.addAssistantMessage('I\'ll calculate 10 * 5 for you.', [
                {
                    id: 'call_calc_explain_001',
                    type: 'function',
                    function: {
                        name: 'calculate',
                        arguments: '{"operation":"multiply","a":10,"b":5}'
                    }
                }
            ]);

            session.addToolMessage('{"result":50}', 'call_calc_explain_001', 'calculate');
            session.addAssistantMessage('The result is 50. I used multiplication to get 10 × 5 = 50.');

            const messages = session.getMessages();

            // Verify the assistant message with both content and tool calls
            const assistantMessage = messages[1];
            expect(assistantMessage.role).toBe('assistant');
            expect(assistantMessage.content).toBe('I\'ll calculate 10 * 5 for you.');
            expect(isAssistantMessage(assistantMessage) && assistantMessage.toolCalls).toHaveLength(1);

            // This should NOT cause infinite loops because the tool call ID is preserved
            expect(isToolMessage(messages[2]) && messages[2].toolCallId).toBe('call_calc_explain_001');
        });
    });
}); 