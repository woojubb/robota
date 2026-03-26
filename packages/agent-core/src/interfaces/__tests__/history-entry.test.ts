/**
 * Tests for IHistoryEntry and conversion functions.
 */

import { describe, it, expect } from 'vitest';
import {
  isChatEntry,
  chatEntryToMessage,
  messageToHistoryEntry,
  getMessagesForAPI,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from '../../index';
import type { IHistoryEntry } from '../../index';

describe('IHistoryEntry', () => {
  describe('isChatEntry', () => {
    it('returns true for chat entries', () => {
      const entry: IHistoryEntry = {
        id: '1',
        timestamp: new Date(),
        category: 'chat',
        type: 'user',
      };
      expect(isChatEntry(entry)).toBe(true);
    });

    it('returns false for event entries', () => {
      const entry: IHistoryEntry = {
        id: '1',
        timestamp: new Date(),
        category: 'event',
        type: 'skill-invocation',
      };
      expect(isChatEntry(entry)).toBe(false);
    });
  });

  describe('messageToHistoryEntry', () => {
    it('converts user message to history entry', () => {
      const msg = createUserMessage('hello');
      const entry = messageToHistoryEntry(msg);

      expect(entry.id).toBe(msg.id);
      expect(entry.category).toBe('chat');
      expect(entry.type).toBe('user');
      expect(entry.data).toBeDefined();
      expect((entry.data as Record<string, unknown>).content).toBe('hello');
      expect((entry.data as Record<string, unknown>).role).toBe('user');
    });

    it('converts assistant message to history entry', () => {
      const msg = createAssistantMessage('response');
      const entry = messageToHistoryEntry(msg);

      expect(entry.category).toBe('chat');
      expect(entry.type).toBe('assistant');
      expect((entry.data as Record<string, unknown>).content).toBe('response');
    });

    it('converts tool message to history entry', () => {
      const msg = createToolMessage('result', { toolCallId: 'tc-1', name: 'Read' });
      const entry = messageToHistoryEntry(msg);

      expect(entry.category).toBe('chat');
      expect(entry.type).toBe('tool');
      expect((entry.data as Record<string, unknown>).toolCallId).toBe('tc-1');
    });
  });

  describe('chatEntryToMessage', () => {
    it('converts chat entry back to TUniversalMessage', () => {
      const msg = createUserMessage('hello');
      const entry = messageToHistoryEntry(msg);
      const restored = chatEntryToMessage(entry);

      expect(restored.role).toBe('user');
      expect(restored.content).toBe('hello');
      expect(restored.id).toBe(msg.id);
    });

    it('preserves assistant message fields', () => {
      const msg = createAssistantMessage('response', { state: 'interrupted' });
      const entry = messageToHistoryEntry(msg);
      const restored = chatEntryToMessage(entry);

      expect(restored.role).toBe('assistant');
      expect(restored.content).toBe('response');
      expect(restored.state).toBe('interrupted');
    });

    it('preserves tool message fields', () => {
      const msg = createToolMessage('output', { toolCallId: 'tc-1', name: 'Bash' });
      const entry = messageToHistoryEntry(msg);
      const restored = chatEntryToMessage(entry);

      expect(restored.role).toBe('tool');
      expect((restored as { toolCallId: string }).toolCallId).toBe('tc-1');
      expect((restored as { name: string }).name).toBe('Bash');
    });
  });

  describe('getMessagesForAPI', () => {
    it('filters only chat entries and converts to messages', () => {
      const history: IHistoryEntry[] = [
        messageToHistoryEntry(createUserMessage('hello')),
        {
          id: '2',
          timestamp: new Date(),
          category: 'event',
          type: 'skill-invocation',
          data: { skillName: 'audit' },
        },
        messageToHistoryEntry(createAssistantMessage('response')),
        {
          id: '4',
          timestamp: new Date(),
          category: 'event',
          type: 'compaction',
          data: { before: 80, after: 30 },
        },
      ];

      const messages = getMessagesForAPI(history);

      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toBe('user');
      expect(messages[1]!.role).toBe('assistant');
    });

    it('returns empty array for history with no chat entries', () => {
      const history: IHistoryEntry[] = [
        { id: '1', timestamp: new Date(), category: 'event', type: 'session-start' },
      ];

      expect(getMessagesForAPI(history)).toEqual([]);
    });

    it('preserves message order', () => {
      const history: IHistoryEntry[] = [
        messageToHistoryEntry(createUserMessage('first')),
        messageToHistoryEntry(createAssistantMessage('second')),
        messageToHistoryEntry(createUserMessage('third')),
      ];

      const messages = getMessagesForAPI(history);
      expect(messages[0]!.content).toBe('first');
      expect(messages[1]!.content).toBe('second');
      expect(messages[2]!.content).toBe('third');
    });
  });

  describe('event entries', () => {
    it('can create arbitrary event entries', () => {
      const entry: IHistoryEntry<{ skillName: string; source: string }> = {
        id: 'evt-1',
        timestamp: new Date(),
        category: 'event',
        type: 'skill-invocation',
        data: { skillName: 'audit', source: 'plugin' },
      };

      expect(entry.category).toBe('event');
      expect(entry.type).toBe('skill-invocation');
      expect(entry.data?.skillName).toBe('audit');
    });

    it('event entries are excluded from getMessagesForAPI', () => {
      const history: IHistoryEntry[] = [
        {
          id: '1',
          timestamp: new Date(),
          category: 'event',
          type: 'anything',
          data: { foo: 'bar' },
        },
        { id: '2', timestamp: new Date(), category: 'event', type: 'whatever' },
      ];

      expect(getMessagesForAPI(history)).toEqual([]);
    });
  });
});
