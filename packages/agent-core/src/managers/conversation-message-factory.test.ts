import { describe, it, expect } from 'vitest';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from './conversation-message-factory';
import {
  isUserMessage,
  isAssistantMessage,
  isSystemMessage,
  isToolMessage,
} from '../interfaces/messages';
import type { TUniversalMessage } from '../interfaces/messages';

describe('conversation-message-factory', () => {
  describe('type guards', () => {
    it('isUserMessage returns true for user messages', () => {
      const msg: TUniversalMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        state: 'complete' as const,
        timestamp: new Date(),
      };
      expect(isUserMessage(msg)).toBe(true);
      expect(isAssistantMessage(msg)).toBe(false);
    });

    it('isAssistantMessage returns true for assistant messages', () => {
      const msg: TUniversalMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'hi',
        state: 'complete' as const,
        timestamp: new Date(),
      };
      expect(isAssistantMessage(msg)).toBe(true);
      expect(isUserMessage(msg)).toBe(false);
    });

    it('isSystemMessage returns true for system messages', () => {
      const msg: TUniversalMessage = {
        id: 'msg-1',
        role: 'system',
        content: 'sys',
        state: 'complete' as const,
        timestamp: new Date(),
      };
      expect(isSystemMessage(msg)).toBe(true);
    });

    it('isToolMessage returns true for tool messages', () => {
      const msg: TUniversalMessage = {
        id: 'msg-1',
        role: 'tool',
        content: 'result',
        toolCallId: 'tc-1',
        state: 'complete' as const,
        timestamp: new Date(),
      };
      expect(isToolMessage(msg)).toBe(true);
    });
  });

  describe('createUserMessage', () => {
    it('creates a user message with content', () => {
      const msg = createUserMessage('hello');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('hello');
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it('creates a user message with options', () => {
      const msg = createUserMessage('hello', { name: 'alice', metadata: { key: 'value' } });
      expect(msg.name).toBe('alice');
      expect(msg.metadata).toEqual({ key: 'value' });
    });

    it('creates a user message with parts', () => {
      const parts = [{ type: 'text' as const, text: 'hello' }];
      const msg = createUserMessage('hello', { parts });
      expect(msg.parts).toEqual(parts);
    });
  });

  describe('createAssistantMessage', () => {
    it('creates an assistant message with content', () => {
      const msg = createAssistantMessage('response');
      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe('response');
    });

    it('creates an assistant message with null content', () => {
      const msg = createAssistantMessage(null);
      expect(msg.content).toBeNull();
    });

    it('creates an assistant message with tool calls', () => {
      const toolCalls = [
        { id: 'tc-1', type: 'function' as const, function: { name: 'fn', arguments: '{}' } },
      ];
      const msg = createAssistantMessage('resp', { toolCalls });
      expect(msg.toolCalls).toEqual(toolCalls);
    });
  });

  describe('createSystemMessage', () => {
    it('creates a system message', () => {
      const msg = createSystemMessage('system prompt');
      expect(msg.role).toBe('system');
      expect(msg.content).toBe('system prompt');
    });

    it('creates system message with name and metadata', () => {
      const msg = createSystemMessage('sys', { name: 'admin', metadata: { level: 'high' } });
      expect(msg.name).toBe('admin');
      expect(msg.metadata).toEqual({ level: 'high' });
    });
  });

  describe('createToolMessage', () => {
    it('creates a tool message with required fields', () => {
      const msg = createToolMessage('result text', { toolCallId: 'tc-1' });
      expect(msg.role).toBe('tool');
      expect(msg.content).toBe('result text');
      expect(msg.toolCallId).toBe('tc-1');
    });

    it('creates tool message with name and metadata', () => {
      const msg = createToolMessage('result', {
        toolCallId: 'tc-1',
        name: 'search',
        metadata: { source: 'web' },
      });
      expect(msg.name).toBe('search');
      expect(msg.metadata).toEqual({ source: 'web' });
    });
  });
});
