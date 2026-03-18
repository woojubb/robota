import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../session-store.js';
import type { ISessionRecord } from '../session-store.js';

function makeRecord(overrides: Partial<ISessionRecord> = {}): ISessionRecord {
  return {
    id: 'test-session-001',
    cwd: '/home/user/project',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T01:00:00.000Z',
    messages: [],
    ...overrides,
  };
}

describe('SessionStore', () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'robota-session-test-'));
    store = new SessionStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save and load', () => {
    it('saves a session and loads it back by id', () => {
      const record = makeRecord();
      store.save(record);
      const loaded = store.load(record.id);
      expect(loaded).toEqual(record);
    });

    it('preserves all fields including messages', () => {
      const record = makeRecord({
        id: 'msg-session',
        name: 'My Session',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'world' },
        ],
      });
      store.save(record);
      const loaded = store.load(record.id);
      expect(loaded?.messages).toHaveLength(2);
      expect(loaded?.name).toBe('My Session');
    });

    it('overwrites an existing session on re-save', () => {
      const record = makeRecord();
      store.save(record);

      const updated = { ...record, updatedAt: '2024-06-01T00:00:00.000Z', messages: [{ x: 1 }] };
      store.save(updated);

      const loaded = store.load(record.id);
      expect(loaded?.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      expect(loaded?.messages).toHaveLength(1);
    });
  });

  describe('load', () => {
    it('returns undefined for a missing session', () => {
      const result = store.load('nonexistent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns empty array when no sessions exist', () => {
      expect(store.list()).toEqual([]);
    });

    it('lists all saved sessions', () => {
      store.save(makeRecord({ id: 'a', updatedAt: '2024-01-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'b', updatedAt: '2024-01-02T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'c', updatedAt: '2024-01-03T00:00:00.000Z' }));
      const sessions = store.list();
      expect(sessions).toHaveLength(3);
    });

    it('sorts sessions by updatedAt descending (most recent first)', () => {
      store.save(makeRecord({ id: 'old', updatedAt: '2024-01-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'new', updatedAt: '2024-03-01T00:00:00.000Z' }));
      store.save(makeRecord({ id: 'mid', updatedAt: '2024-02-01T00:00:00.000Z' }));
      const sessions = store.list();
      expect(sessions[0].id).toBe('new');
      expect(sessions[1].id).toBe('mid');
      expect(sessions[2].id).toBe('old');
    });

    it('returns empty array when base directory does not exist', () => {
      const nonExistentStore = new SessionStore(join(tmpDir, 'does-not-exist'));
      expect(nonExistentStore.list()).toEqual([]);
    });
  });

  describe('delete', () => {
    it('deletes a session by id', () => {
      const record = makeRecord();
      store.save(record);
      store.delete(record.id);
      expect(store.load(record.id)).toBeUndefined();
    });

    it('does not throw when deleting a nonexistent session', () => {
      expect(() => store.delete('nonexistent-id')).not.toThrow();
    });

    it('removes the session from list after deletion', () => {
      store.save(makeRecord({ id: 'keep' }));
      store.save(makeRecord({ id: 'remove' }));
      store.delete('remove');
      const sessions = store.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('keep');
    });
  });

  describe('directory creation', () => {
    it('creates the base directory on first save', () => {
      const nestedDir = join(tmpDir, 'nested', 'sessions');
      const nestedStore = new SessionStore(nestedDir);
      nestedStore.save(makeRecord({ id: 'first' }));
      const loaded = nestedStore.load('first');
      expect(loaded?.id).toBe('first');
    });
  });
});
