import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleMemory, PersistentSystemMemory } from './memory';
import type { Message } from './types';

describe('SimpleMemory', () => {
    let memory: SimpleMemory;

    beforeEach(() => {
        memory = new SimpleMemory();
    });

    it('초기 상태에서 빈 메시지 배열을 반환해야 함', () => {
        expect(memory.getMessages()).toEqual([]);
    });

    it('메시지를 추가하고 반환할 수 있어야 함', () => {
        const message: Message = { role: 'user', content: '안녕하세요' };
        memory.addMessage(message);
        expect(memory.getMessages()).toEqual([message]);
    });

    it('여러 메시지를 추가하고 모두 반환할 수 있어야 함', () => {
        const message1: Message = { role: 'user', content: '안녕하세요' };
        const message2: Message = { role: 'assistant', content: '무엇을 도와드릴까요?' };

        memory.addMessage(message1);
        memory.addMessage(message2);

        expect(memory.getMessages()).toEqual([message1, message2]);
    });

    it('clear 메서드로 모든 메시지를 지울 수 있어야 함', () => {
        const message: Message = { role: 'user', content: '안녕하세요' };
        memory.addMessage(message);
        memory.clear();
        expect(memory.getMessages()).toEqual([]);
    });

    it('maxMessages 옵션으로 메시지 수를 제한할 수 있어야 함', () => {
        const limitedMemory = new SimpleMemory({ maxMessages: 2 });

        const message1: Message = { role: 'user', content: '첫 번째 메시지' };
        const message2: Message = { role: 'assistant', content: '두 번째 메시지' };
        const message3: Message = { role: 'user', content: '세 번째 메시지' };

        limitedMemory.addMessage(message1);
        limitedMemory.addMessage(message2);
        limitedMemory.addMessage(message3);

        // 가장 오래된 메시지가 제거되고 최신 메시지 2개만 유지되어야 함
        expect(limitedMemory.getMessages()).toEqual([message2, message3]);
    });

    it('maxMessages 제한 시 시스템 메시지는 항상 유지되어야 함', () => {
        const limitedMemory = new SimpleMemory({ maxMessages: 3 });

        const systemMessage: Message = { role: 'system', content: '시스템 지시사항' };
        const message1: Message = { role: 'user', content: '첫 번째 메시지' };
        const message2: Message = { role: 'assistant', content: '두 번째 메시지' };
        const message3: Message = { role: 'user', content: '세 번째 메시지' };

        limitedMemory.addMessage(systemMessage);
        limitedMemory.addMessage(message1);
        limitedMemory.addMessage(message2);
        limitedMemory.addMessage(message3);

        // 시스템 메시지와 최신 메시지 2개가 유지되어야 함
        expect(limitedMemory.getMessages()).toEqual([systemMessage, message2, message3]);
    });
});

describe('PersistentSystemMemory', () => {
    const systemPrompt = '당신은 AI 비서입니다.';
    let memory: PersistentSystemMemory;

    beforeEach(() => {
        memory = new PersistentSystemMemory(systemPrompt);
    });

    it('초기화 시 시스템 메시지가 추가되어야 함', () => {
        const messages = memory.getMessages();
        expect(messages.length).toBe(1);
        expect(messages[0]).toEqual({ role: 'system', content: systemPrompt });
    });

    it('메시지를 추가하고 반환할 수 있어야 함', () => {
        const userMessage: Message = { role: 'user', content: '안녕하세요' };
        memory.addMessage(userMessage);

        const messages = memory.getMessages();
        expect(messages.length).toBe(2);
        expect(messages[0]).toEqual({ role: 'system', content: systemPrompt });
        expect(messages[1]).toEqual(userMessage);
    });

    it('clear 메서드는 모든 메시지를 지우고 시스템 메시지를 다시 추가해야 함', () => {
        const userMessage: Message = { role: 'user', content: '안녕하세요' };
        memory.addMessage(userMessage);
        memory.clear();

        const messages = memory.getMessages();
        expect(messages.length).toBe(1);
        expect(messages[0]).toEqual({ role: 'system', content: systemPrompt });
    });

    it('updateSystemPrompt 메서드는 시스템 프롬프트를 업데이트해야 함', () => {
        const newSystemPrompt = '당신은 친절한 AI 비서입니다.';
        const userMessage: Message = { role: 'user', content: '안녕하세요' };

        memory.addMessage(userMessage);
        memory.updateSystemPrompt(newSystemPrompt);

        const messages = memory.getMessages();
        expect(messages.length).toBe(2);
        expect(messages[0]).toEqual({ role: 'system', content: newSystemPrompt });
        expect(messages[1]).toEqual(userMessage);
    });
}); 