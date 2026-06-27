/**
 * PLUGIN-002: DatabaseHistoryStorage persists through an injected IDatabaseDriver
 * (no silent stub). Exercised here with an in-memory fake driver.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseHistoryStorage } from '../database-storage';
import type { IDatabaseDriver } from '../../types';
import type { IConversationHistoryEntry } from '../../types';

function createMemoryDriver(): IDatabaseDriver {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      return store.delete(key);
    },
    async list(prefix) {
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
    async clear(prefix) {
      for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
    },
  };
}

function makeEntry(id: string): IConversationHistoryEntry {
  return {
    conversationId: id,
    messages: [{ id: 'm1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() }],
    startTime: new Date('2026-06-01T00:00:00.000Z'),
    lastUpdated: new Date('2026-06-01T00:01:00.000Z'),
    metadata: {},
  } as IConversationHistoryEntry;
}

describe('DatabaseHistoryStorage (PLUGIN-002)', () => {
  it('round-trips an entry through the driver with revived Dates', async () => {
    const storage = new DatabaseHistoryStorage(createMemoryDriver());
    await storage.save('conv-1', makeEntry('conv-1'));
    const loaded = await storage.load('conv-1');
    expect(loaded?.conversationId).toBe('conv-1');
    expect(loaded?.startTime).toBeInstanceOf(Date);
  });

  it('lists, deletes, and clears', async () => {
    const storage = new DatabaseHistoryStorage(createMemoryDriver());
    await storage.save('a', makeEntry('a'));
    await storage.save('b', makeEntry('b'));
    expect((await storage.list()).sort()).toEqual(['a', 'b']);
    expect(await storage.delete('a')).toBe(true);
    expect(await storage.delete('a')).toBe(false);
    await storage.clear();
    expect(await storage.list()).toEqual([]);
  });
});
