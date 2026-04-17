import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { ConversationHistoryPlugin } from '../conversation-history-plugin';
import { ConfigurationError, PluginError } from '@robota-sdk/agent-core';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

function createUserMessage(content: string): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}

function createAssistantMessage(content: string): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}

describe('ConversationHistoryPlugin', () => {
  let plugin: ConversationHistoryPlugin;

  afterEach(async () => {
    if (plugin) {
      await plugin.destroy();
    }
  });

  describe('constructor', () => {
    it('initializes with memory storage', () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });
      expect(plugin.name).toBe('ConversationHistoryPlugin');
    });

    it('throws on missing storage strategy', () => {
      expect(() => new ConversationHistoryPlugin({ storage: '' as any })).toThrow(
        ConfigurationError,
      );
    });

    it('throws on invalid storage strategy', () => {
      expect(() => new ConversationHistoryPlugin({ storage: 'redis' as any })).toThrow(
        ConfigurationError,
      );
    });

    it('throws on non-positive maxConversations', () => {
      expect(
        () => new ConversationHistoryPlugin({ storage: 'memory', maxConversations: 0 }),
      ).toThrow(ConfigurationError);
    });

    it('throws on non-positive maxMessagesPerConversation', () => {
      expect(
        () => new ConversationHistoryPlugin({ storage: 'memory', maxMessagesPerConversation: -1 }),
      ).toThrow(ConfigurationError);
    });

    it('throws when file storage is missing filePath', () => {
      expect(() => new ConversationHistoryPlugin({ storage: 'file', filePath: '' })).toThrow(
        ConfigurationError,
      );
    });

    it('throws when database storage is missing connectionString', () => {
      expect(
        () => new ConversationHistoryPlugin({ storage: 'database', connectionString: '' }),
      ).toThrow(ConfigurationError);
    });
  });

  describe('conversation CRUD', () => {
    it('starts a conversation and retrieves it', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });
      await plugin.startConversation('conv-1');

      const entry = await plugin.loadConversation('conv-1');
      expect(entry).toBeDefined();
      expect(entry!.conversationId).toBe('conv-1');
      expect(entry!.messages).toEqual([]);
    });

    it('adds messages to a conversation', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });
      await plugin.startConversation('conv-1');

      await plugin.addMessage(createUserMessage('hello'));
      await plugin.addMessage(createAssistantMessage('hi there'));

      const messages = await plugin.getHistory('conv-1');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('throws when adding message without active conversation', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });

      await expect(plugin.addMessage(createUserMessage('hello'))).rejects.toThrow(PluginError);
    });

    it('lists conversations', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });
      await plugin.startConversation('conv-1');
      await plugin.startConversation('conv-2');

      const ids = await plugin.listConversations();
      expect(ids).toContain('conv-1');
      expect(ids).toContain('conv-2');
    });

    it('deletes a conversation', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });
      await plugin.startConversation('conv-1');

      const deleted = await plugin.deleteConversation('conv-1');
      expect(deleted).toBe(true);

      const entry = await plugin.loadConversation('conv-1');
      expect(entry).toBeUndefined();
    });

    it('clears all conversations', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });
      await plugin.startConversation('conv-1');
      await plugin.startConversation('conv-2');

      await plugin.clearAllConversations();

      const ids = await plugin.listConversations();
      expect(ids).toHaveLength(0);
    });
  });

  describe('message trimming', () => {
    it('trims messages when exceeding maxMessagesPerConversation', async () => {
      plugin = new ConversationHistoryPlugin({
        storage: 'memory',
        maxMessagesPerConversation: 3,
      });
      await plugin.startConversation('conv-1');

      for (let i = 0; i < 5; i++) {
        await plugin.addMessage(createUserMessage(`msg-${i}`));
      }

      const messages = await plugin.getHistory('conv-1');
      expect(messages).toHaveLength(3);
      // Should keep the last 3 messages
      expect(messages[0].content).toBe('msg-2');
      expect(messages[2].content).toBe('msg-4');
    });
  });

  describe('getHistory', () => {
    it('returns empty array for unknown conversation', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });

      const messages = await plugin.getHistory('nonexistent');
      expect(messages).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('completes without error', async () => {
      plugin = new ConversationHistoryPlugin({ storage: 'memory' });
      await expect(plugin.destroy()).resolves.not.toThrow();
    });
  });
});
