import { describe, it, expect, beforeEach } from 'vitest';
import {
    SimpleConversationHistory,
    PersistentSystemConversationHistory,
    type UniversalMessage
} from '../conversation-history';
import type { FunctionCall, FunctionCallResult } from '@robota-sdk/tools';

describe('SimpleConversationHistory', () => {
    let history: SimpleConversationHistory;

    beforeEach(() => {
        history = new SimpleConversationHistory();
    });

    describe('Basic functionality', () => {
        it('should have no messages in initial state', () => {
            expect(history.getMessages()).toEqual([]);
            expect(history.getMessageCount()).toBe(0);
        });

        it('should be able to add messages', () => {
            const message: UniversalMessage = {
                role: 'user',
                content: 'Hello',
                timestamp: new Date()
            };

            history.addMessage(message);

            expect(history.getMessages()).toHaveLength(1);
            expect(history.getMessages()[0]).toEqual(message);
            expect(history.getMessageCount()).toBe(1);
        });

        it('should store multiple messages in order', () => {
            const message1: UniversalMessage = {
                role: 'user',
                content: 'First message',
                timestamp: new Date()
            };
            const message2: UniversalMessage = {
                role: 'assistant',
                content: 'Second message',
                timestamp: new Date()
            };

            history.addMessage(message1);
            history.addMessage(message2);

            const messages = history.getMessages();
            expect(messages).toHaveLength(2);
            expect(messages[0]).toEqual(message1);
            expect(messages[1]).toEqual(message2);
        });

        it('should be able to clear all messages with clear method', () => {
            history.addUserMessage('Test message');
            expect(history.getMessageCount()).toBe(1);

            history.clear();
            expect(history.getMessages()).toEqual([]);
            expect(history.getMessageCount()).toBe(0);
        });
    });

    describe('Convenience methods', () => {
        it('should be able to add user message with addUserMessage', () => {
            history.addUserMessage('Hello');

            const messages = history.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('user');
            expect(messages[0].content).toBe('Hello');
            expect(messages[0].timestamp).toBeInstanceOf(Date);
        });

        it('should be able to add assistant message with addAssistantMessage', () => {
            const functionCall: FunctionCall = {
                name: 'test_function',
                arguments: { param: 'value' }
            };

            history.addAssistantMessage('Response', functionCall);

            const messages = history.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('assistant');
            expect(messages[0].content).toBe('Response');
            expect(messages[0].functionCall).toEqual(functionCall);
        });

        it('should be able to add system message with addSystemMessage', () => {
            history.addSystemMessage('System prompt');

            const messages = history.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toBe('System prompt');
        });

        it('should be able to add tool execution result with addToolMessage', () => {
            const toolResult: FunctionCallResult = {
                name: 'test_tool',
                result: 'Tool executed successfully'
            };

            history.addToolMessage(toolResult);

            const messages = history.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('tool');
            expect(messages[0].name).toBe('test_tool');
            expect(messages[0].toolResult).toEqual(toolResult);
            expect(messages[0].content).toContain('Tool result');
        });

        it('should generate appropriate content when there is error in addToolMessage', () => {
            const toolResult: FunctionCallResult = {
                name: 'failed_tool',
                error: 'Tool execution failed'
            };

            history.addToolMessage(toolResult);

            const messages = history.getMessages();
            expect(messages[0].content).toContain('Tool execution error');
            expect(messages[0].content).toContain('Tool execution failed');
        });
    });

    describe('Message retrieval', () => {
        beforeEach(() => {
            history.addSystemMessage('System');
            history.addUserMessage('User');
            history.addAssistantMessage('Assistant');
            history.addToolMessage({ name: 'tool', result: 'result' });
        });

        it('should be able to get messages by specific role with getMessagesByRole', () => {
            const userMessages = history.getMessagesByRole('user');
            expect(userMessages).toHaveLength(1);
            expect(userMessages[0].content).toBe('User');

            const systemMessages = history.getMessagesByRole('system');
            expect(systemMessages).toHaveLength(1);
            expect(systemMessages[0].content).toBe('System');
        });

        it('should be able to get recent messages with getRecentMessages', () => {
            const recentMessages = history.getRecentMessages(2);
            expect(recentMessages).toHaveLength(2);
            expect(recentMessages[0].content).toBe('Assistant');
            expect(recentMessages[1].role).toBe('tool');
        });

        it('should return all messages when requested count is less than available messages in getRecentMessages', () => {
            const recentMessages = history.getRecentMessages(10);
            expect(recentMessages).toHaveLength(4);
        });
    });

    describe('Message limit', () => {
        it('should be able to limit message count with maxMessages setting', () => {
            const limitedHistory = new SimpleConversationHistory({ maxMessages: 3 });

            limitedHistory.addUserMessage('Message 1');
            limitedHistory.addUserMessage('Message 2');
            limitedHistory.addUserMessage('Message 3');
            limitedHistory.addUserMessage('Message 4');

            expect(limitedHistory.getMessageCount()).toBe(3);
            const messages = limitedHistory.getMessages();
            expect(messages[0].content).toBe('Message 2');
            expect(messages[2].content).toBe('Message 4');
        });

        it('should exclude system messages from limit', () => {
            const limitedHistory = new SimpleConversationHistory({ maxMessages: 3 });

            limitedHistory.addSystemMessage('System');
            limitedHistory.addUserMessage('User 1');
            limitedHistory.addUserMessage('User 2');
            limitedHistory.addUserMessage('User 3');
            limitedHistory.addUserMessage('User 4');

            expect(limitedHistory.getMessageCount()).toBe(3);
            const systemMessages = limitedHistory.getMessagesByRole('system');
            expect(systemMessages).toHaveLength(1);
            expect(systemMessages[0].content).toBe('System');

            // Only the most recent 2 user messages should be maintained
            const userMessages = limitedHistory.getMessagesByRole('user');
            expect(userMessages).toHaveLength(2);
            expect(userMessages[0].content).toBe('User 3');
            expect(userMessages[1].content).toBe('User 4');
        });
    });
});

describe('PersistentSystemConversationHistory', () => {
    let history: PersistentSystemConversationHistory;
    const systemPrompt = 'You are a helpful assistant';

    beforeEach(() => {
        history = new PersistentSystemConversationHistory(systemPrompt);
    });

    it('should add system message during initialization', () => {
        const messages = history.getMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toBe(systemPrompt);
    });

    it('should maintain system messages even after clear', () => {
        history.addUserMessage('Test message');
        expect(history.getMessageCount()).toBe(2);

        history.clear();
        const messages = history.getMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toBe(systemPrompt);
    });

    it('should be able to update system prompt with updateSystemPrompt', () => {
        history.addUserMessage('User message');
        history.addAssistantMessage('Assistant message');

        const newSystemPrompt = 'You are a coding assistant';
        history.updateSystemPrompt(newSystemPrompt);

        const messages = history.getMessages();
        const systemMessages = messages.filter(m => m.role === 'system');
        expect(systemMessages).toHaveLength(1);
        expect(systemMessages[0].content).toBe(newSystemPrompt);

        // Other messages should be maintained
        expect(messages.filter(m => m.role === 'user')).toHaveLength(1);
        expect(messages.filter(m => m.role === 'assistant')).toHaveLength(1);
    });

    it('should be able to get current system prompt with getSystemPrompt', () => {
        expect(history.getSystemPrompt()).toBe(systemPrompt);

        const newPrompt = 'New prompt';
        history.updateSystemPrompt(newPrompt);
        expect(history.getSystemPrompt()).toBe(newPrompt);
    });
}); 