import { describe, it, expect } from 'vitest';
import { DatabaseHistoryStorage } from '../storages/database-storage';
import { FileHistoryStorage } from '../storages/file-storage';
import { MemoryHistoryStorage } from '../storages/memory-storage';
import type { IConversationHistoryEntry } from '../types';

const entry: IConversationHistoryEntry = {
  conversationId: 'conv-1',
  messages: [{ role: 'user', content: 'hello', timestamp: new Date() }],
  startTime: new Date(),
  lastUpdated: new Date(),
  metadata: {},
};

describe('MemoryHistoryStorage', () => {
  it('saves and loads entries', async () => {
    const storage = new MemoryHistoryStorage();
    await storage.save('conv-1', entry);
    const loaded = await storage.load('conv-1');
    expect(loaded).toBeDefined();
    expect(loaded!.conversationId).toBe('conv-1');
  });

  it('returns undefined for missing conversation', async () => {
    const storage = new MemoryHistoryStorage();
    expect(await storage.load('missing')).toBeUndefined();
  });

  it('lists conversation IDs', async () => {
    const storage = new MemoryHistoryStorage();
    await storage.save('conv-1', entry);
    await storage.save('conv-2', { ...entry, conversationId: 'conv-2' });
    const list = await storage.list();
    expect(list).toContain('conv-1');
    expect(list).toContain('conv-2');
  });

  it('deletes a conversation', async () => {
    const storage = new MemoryHistoryStorage();
    await storage.save('conv-1', entry);
    const deleted = await storage.delete('conv-1');
    expect(deleted).toBe(true);
    expect(await storage.load('conv-1')).toBeUndefined();
  });

  it('returns false when deleting non-existent', async () => {
    const storage = new MemoryHistoryStorage();
    expect(await storage.delete('missing')).toBe(false);
  });

  it('clears all conversations', async () => {
    const storage = new MemoryHistoryStorage();
    await storage.save('conv-1', entry);
    await storage.clear();
    expect(await storage.list()).toHaveLength(0);
  });
});

describe('DatabaseHistoryStorage', () => {
  // Placeholder implementation - tests verify it does not throw
  const storage = new DatabaseHistoryStorage('postgres://user:pass@host/db');

  it('save does not throw', async () => {
    await expect(storage.save('conv-1', entry)).resolves.toBeUndefined();
  });

  it('load returns undefined', async () => {
    expect(await storage.load('conv-1')).toBeUndefined();
  });

  it('list returns empty array', async () => {
    expect(await storage.list()).toEqual([]);
  });

  it('delete returns false', async () => {
    expect(await storage.delete('conv-1')).toBe(false);
  });

  it('clear does not throw', async () => {
    await expect(storage.clear()).resolves.toBeUndefined();
  });
});

describe('FileHistoryStorage', () => {
  // Placeholder implementation - tests verify it does not throw
  const storage = new FileHistoryStorage('/tmp/history.json');

  it('save does not throw', async () => {
    await expect(storage.save('conv-1', entry)).resolves.toBeUndefined();
  });

  it('load returns undefined', async () => {
    expect(await storage.load('conv-1')).toBeUndefined();
  });

  it('list returns empty array', async () => {
    expect(await storage.list()).toEqual([]);
  });

  it('delete returns false', async () => {
    expect(await storage.delete('conv-1')).toBe(false);
  });

  it('clear does not throw', async () => {
    await expect(storage.clear()).resolves.toBeUndefined();
  });
});
