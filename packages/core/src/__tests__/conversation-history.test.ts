import { describe, it, expect, beforeEach } from 'vitest';
import {
    SimpleConversationHistory,
    PersistentSystemConversationHistory,
    type UniversalMessage,
    type UniversalMessageRole
} from '../conversation-history';
import type { FunctionCall, FunctionCallResult } from '@robota-sdk/tools';

describe('SimpleConversationHistory', () => {
    let history: SimpleConversationHistory;

    beforeEach(() => {
        history = new SimpleConversationHistory();
    });

    describe('기본 기능', () => {
        it('초기 상태에서는 메시지가 없어야 함', () => {
            expect(history.getMessages()).toEqual([]);
            expect(history.getMessageCount()).toBe(0);
        });

        it('메시지를 추가할 수 있어야 함', () => {
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

        it('여러 메시지를 순서대로 저장해야 함', () => {
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

        it('clear 메서드로 모든 메시지를 삭제할 수 있어야 함', () => {
            history.addUserMessage('Test message');
            expect(history.getMessageCount()).toBe(1);

            history.clear();
            expect(history.getMessages()).toEqual([]);
            expect(history.getMessageCount()).toBe(0);
        });
    });

    describe('편의 메서드', () => {
        it('addUserMessage로 사용자 메시지를 추가할 수 있어야 함', () => {
            history.addUserMessage('Hello');

            const messages = history.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('user');
            expect(messages[0].content).toBe('Hello');
            expect(messages[0].timestamp).toBeInstanceOf(Date);
        });

        it('addAssistantMessage로 어시스턴트 메시지를 추가할 수 있어야 함', () => {
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

        it('addSystemMessage로 시스템 메시지를 추가할 수 있어야 함', () => {
            history.addSystemMessage('System prompt');

            const messages = history.getMessages();
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toBe('System prompt');
        });

        it('addToolMessage로 도구 실행 결과를 추가할 수 있어야 함', () => {
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

        it('addToolMessage에서 에러가 있을 때 적절한 content를 생성해야 함', () => {
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

    describe('메시지 조회', () => {
        beforeEach(() => {
            history.addSystemMessage('System');
            history.addUserMessage('User');
            history.addAssistantMessage('Assistant');
            history.addToolMessage({ name: 'tool', result: 'result' });
        });

        it('getMessagesByRole로 특정 역할의 메시지만 가져올 수 있어야 함', () => {
            const userMessages = history.getMessagesByRole('user');
            expect(userMessages).toHaveLength(1);
            expect(userMessages[0].content).toBe('User');

            const systemMessages = history.getMessagesByRole('system');
            expect(systemMessages).toHaveLength(1);
            expect(systemMessages[0].content).toBe('System');
        });

        it('getRecentMessages로 최근 메시지를 가져올 수 있어야 함', () => {
            const recentMessages = history.getRecentMessages(2);
            expect(recentMessages).toHaveLength(2);
            expect(recentMessages[0].content).toBe('Assistant');
            expect(recentMessages[1].role).toBe('tool');
        });

        it('getRecentMessages에서 요청한 개수보다 메시지가 적으면 모든 메시지를 반환해야 함', () => {
            const recentMessages = history.getRecentMessages(10);
            expect(recentMessages).toHaveLength(4);
        });
    });

    describe('메시지 제한', () => {
        it('maxMessages 설정으로 메시지 개수를 제한할 수 있어야 함', () => {
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

        it('시스템 메시지는 제한에서 제외되어야 함', () => {
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

            // 가장 최근 사용자 메시지 2개만 유지되어야 함
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

    it('초기화 시 시스템 메시지가 추가되어야 함', () => {
        const messages = history.getMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toBe(systemPrompt);
    });

    it('clear 후에도 시스템 메시지가 유지되어야 함', () => {
        history.addUserMessage('Test message');
        expect(history.getMessageCount()).toBe(2);

        history.clear();
        const messages = history.getMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toBe(systemPrompt);
    });

    it('updateSystemPrompt로 시스템 프롬프트를 업데이트할 수 있어야 함', () => {
        history.addUserMessage('User message');
        history.addAssistantMessage('Assistant message');

        const newSystemPrompt = 'You are a coding assistant';
        history.updateSystemPrompt(newSystemPrompt);

        const messages = history.getMessages();
        const systemMessages = messages.filter(m => m.role === 'system');
        expect(systemMessages).toHaveLength(1);
        expect(systemMessages[0].content).toBe(newSystemPrompt);

        // 다른 메시지들은 유지되어야 함
        expect(messages.filter(m => m.role === 'user')).toHaveLength(1);
        expect(messages.filter(m => m.role === 'assistant')).toHaveLength(1);
    });

    it('getSystemPrompt로 현재 시스템 프롬프트를 가져올 수 있어야 함', () => {
        expect(history.getSystemPrompt()).toBe(systemPrompt);

        const newPrompt = 'New prompt';
        history.updateSystemPrompt(newPrompt);
        expect(history.getSystemPrompt()).toBe(newPrompt);
    });
}); 