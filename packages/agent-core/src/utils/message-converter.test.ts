import { describe, it, expect } from 'vitest';
import { MessageConverter } from './message-converter';
import type {
  TUniversalMessage,
  IUserMessage,
  IAssistantMessage,
  ISystemMessage,
  IToolMessage,
} from '../interfaces/messages';

function makeUserMessage(content: string): IUserMessage {
  return { id: 'msg-1', role: 'user', content, state: 'complete' as const, timestamp: new Date() };
}

function makeAssistantMessage(
  content: string | null,
  toolCalls?: IAssistantMessage['toolCalls'],
): IAssistantMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content,
    state: 'complete' as const,
    timestamp: new Date(),
    ...(toolCalls && { toolCalls }),
  };
}

function makeSystemMessage(content: string): ISystemMessage {
  return {
    id: 'msg-1',
    role: 'system',
    content,
    state: 'complete' as const,
    timestamp: new Date(),
  };
}

function makeToolMessage(content: string, toolCallId: string): IToolMessage {
  return {
    id: 'msg-1',
    role: 'tool',
    content,
    toolCallId,
    state: 'complete' as const,
    timestamp: new Date(),
  };
}

describe('MessageConverter', () => {
  describe('toProviderFormat - OpenAI', () => {
    it('should convert basic messages to OpenAI format', () => {
      const messages: TUniversalMessage[] = [
        makeSystemMessage('You are helpful.'),
        makeUserMessage('Hello'),
        makeAssistantMessage('Hi there!'),
      ];

      const result = MessageConverter.toProviderFormat(messages, 'openai');

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(
        expect.objectContaining({ role: 'system', content: 'You are helpful.' }),
      );
      expect(result[1]).toEqual(expect.objectContaining({ role: 'user', content: 'Hello' }));
      expect(result[2]).toEqual(
        expect.objectContaining({ role: 'assistant', content: 'Hi there!' }),
      );
    });

    it('should include tool_calls for assistant messages with toolCalls', () => {
      const toolCalls = [
        {
          id: 'call_1',
          type: 'function' as const,
          function: { name: 'search', arguments: '{"q":"test"}' },
        },
      ];
      const messages: TUniversalMessage[] = [makeAssistantMessage(null, toolCalls)];

      const result = MessageConverter.toProviderFormat(messages, 'openai');

      const openaiMsg = result[0] as unknown as Record<string, unknown>;
      expect(openaiMsg.role).toBe('assistant');
      expect(openaiMsg.content).toBeNull();
      expect(openaiMsg.tool_calls).toBeDefined();
      const calls = openaiMsg.tool_calls as Array<Record<string, unknown>>;
      expect(calls[0]).toEqual(
        expect.objectContaining({
          id: 'call_1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"test"}' },
        }),
      );
    });

    it('should include tool_call_id for tool messages', () => {
      const messages: TUniversalMessage[] = [makeToolMessage('result data', 'call_1')];

      const result = MessageConverter.toProviderFormat(messages, 'openai');

      const openaiMsg = result[0] as unknown as Record<string, unknown>;
      expect(openaiMsg.role).toBe('tool');
      expect(openaiMsg.tool_call_id).toBe('call_1');
    });
  });

  describe('toProviderFormat - Anthropic', () => {
    it('should filter out system messages', () => {
      const messages: TUniversalMessage[] = [
        makeSystemMessage('System prompt'),
        makeUserMessage('Hello'),
        makeAssistantMessage('Hi'),
      ];

      const result = MessageConverter.toProviderFormat(messages, 'anthropic');

      expect(result).toHaveLength(2);
      expect(
        result.every((m) => {
          const msg = m as unknown as Record<string, unknown>;
          return msg.role !== 'system';
        }),
      ).toBe(true);
    });

    it('should map roles correctly (user stays user, assistant stays assistant)', () => {
      const messages: TUniversalMessage[] = [
        makeUserMessage('question'),
        makeAssistantMessage('answer'),
      ];

      const result = MessageConverter.toProviderFormat(messages, 'anthropic');

      expect(result[0]).toEqual(expect.objectContaining({ role: 'user', content: 'question' }));
      expect(result[1]).toEqual(expect.objectContaining({ role: 'assistant', content: 'answer' }));
    });

    it('should map tool role to user', () => {
      const messages: TUniversalMessage[] = [makeToolMessage('tool result', 'call_1')];

      const result = MessageConverter.toProviderFormat(messages, 'anthropic');

      expect(result[0]).toEqual(expect.objectContaining({ role: 'user' }));
    });
  });

  describe('toProviderFormat - Google', () => {
    it('should map assistant role to model', () => {
      const messages: TUniversalMessage[] = [makeAssistantMessage('model response')];

      const result = MessageConverter.toProviderFormat(messages, 'google');

      const googleMsg = result[0] as unknown as Record<string, unknown>;
      expect(googleMsg.role).toBe('model');
    });

    it('should map user role to user', () => {
      const messages: TUniversalMessage[] = [makeUserMessage('user input')];

      const result = MessageConverter.toProviderFormat(messages, 'google');

      const googleMsg = result[0] as unknown as Record<string, unknown>;
      expect(googleMsg.role).toBe('user');
    });

    it('should use parts structure with text', () => {
      const messages: TUniversalMessage[] = [makeUserMessage('hello')];

      const result = MessageConverter.toProviderFormat(messages, 'google');

      const googleMsg = result[0] as unknown as Record<string, unknown>;
      expect(googleMsg.parts).toEqual([{ text: 'hello' }]);
    });

    it('should map system role to user', () => {
      const messages: TUniversalMessage[] = [makeSystemMessage('system prompt')];

      const result = MessageConverter.toProviderFormat(messages, 'google');

      const googleMsg = result[0] as unknown as Record<string, unknown>;
      expect(googleMsg.role).toBe('user');
    });
  });

  describe('toProviderFormat - Unknown provider', () => {
    it('should return messages in universal format (pass-through)', () => {
      const messages: TUniversalMessage[] = [
        makeUserMessage('hello'),
        makeAssistantMessage('world'),
      ];

      const result = MessageConverter.toProviderFormat(messages, 'custom-provider');

      expect(result).toEqual(messages);
    });
  });

  describe('extractSystemMessage', () => {
    it('should find and return system message content', () => {
      const messages: TUniversalMessage[] = [
        makeSystemMessage('You are a helpful assistant.'),
        makeUserMessage('Hello'),
      ];

      const systemContent = MessageConverter.extractSystemMessage(messages);
      expect(systemContent).toBe('You are a helpful assistant.');
    });

    it('should return undefined when no system message exists', () => {
      const messages: TUniversalMessage[] = [makeUserMessage('Hello'), makeAssistantMessage('Hi')];

      const systemContent = MessageConverter.extractSystemMessage(messages);
      expect(systemContent).toBeUndefined();
    });
  });

  describe('filterNonSystemMessages', () => {
    it('should filter out system messages', () => {
      const messages: TUniversalMessage[] = [
        makeSystemMessage('system'),
        makeUserMessage('user'),
        makeAssistantMessage('assistant'),
        makeSystemMessage('another system'),
      ];

      const filtered = MessageConverter.filterNonSystemMessages(messages);

      expect(filtered).toHaveLength(2);
      expect(filtered.every((m) => m.role !== 'system')).toBe(true);
    });

    it('should return all messages when there are no system messages', () => {
      const messages: TUniversalMessage[] = [
        makeUserMessage('user'),
        makeAssistantMessage('assistant'),
      ];

      const filtered = MessageConverter.filterNonSystemMessages(messages);
      expect(filtered).toHaveLength(2);
    });

    it('should return empty array for empty input', () => {
      const filtered = MessageConverter.filterNonSystemMessages([]);
      expect(filtered).toEqual([]);
    });
  });
});
