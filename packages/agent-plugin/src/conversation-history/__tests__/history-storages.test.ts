import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileHistoryStorage } from '../storages/file-storage';
import { MemoryHistoryStorage } from '../storages/memory-storage';
import type { IConversationHistoryEntry } from '../types';

const entry: IConversationHistoryEntry = {
  conversationId: 'conv-1',
  messages: [
    {
      id: 'msg-1',
      role: 'user',
      content: 'hello',
      state: 'complete' as const,
      timestamp: new Date(),
    },
  ],
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

// DatabaseHistoryStorage now requires an injected IDatabaseDriver (PLUGIN-002); its real
// round-trip behavior is covered in storages/__tests__/database-storage.test.ts.

describe('FileHistoryStorage (PLUGIN-001: real persistence)', () => {
  let dir: string;
  let storage: FileHistoryStorage;

  function freshStorage(): { dir: string; storage: FileHistoryStorage } {
    const d = mkdtempSync(join(tmpdir(), 'robota-hist-'));
    return { dir: d, storage: new FileHistoryStorage(join(d, 'history.json')) };
  }

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('persists and reloads an entry (round-trip with revived Dates)', async () => {
    ({ dir, storage } = freshStorage());
    await storage.save('conv-1', entry);
    const loaded = await storage.load('conv-1');
    expect(loaded).toBeDefined();
    expect(loaded!.conversationId).toBe('conv-1');
    expect(loaded!.startTime).toBeInstanceOf(Date);
    expect(loaded!.messages[0]!.content).toBe('hello');
  });

  it('survives a new storage instance pointed at the same file', async () => {
    ({ dir, storage } = freshStorage());
    const filePath = join(dir, 'history.json');
    await new FileHistoryStorage(filePath).save('conv-1', entry);
    const reopened = new FileHistoryStorage(filePath);
    expect((await reopened.load('conv-1'))?.conversationId).toBe('conv-1');
  });

  it('returns undefined for a missing conversation and [] for an absent file', async () => {
    ({ dir, storage } = freshStorage());
    expect(await storage.load('missing')).toBeUndefined();
    expect(await storage.list()).toEqual([]);
  });

  it('lists, deletes, and clears', async () => {
    ({ dir, storage } = freshStorage());
    await storage.save('conv-1', entry);
    await storage.save('conv-2', { ...entry, conversationId: 'conv-2' });
    expect((await storage.list()).sort()).toEqual(['conv-1', 'conv-2']);
    expect(await storage.delete('conv-1')).toBe(true);
    expect(await storage.delete('conv-1')).toBe(false);
    await storage.clear();
    expect(await storage.list()).toEqual([]);
  });
});
