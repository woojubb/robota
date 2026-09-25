import DatabaseConstructor from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { SqliteStorageAdapter } from '../sqlite-storage-adapter.js';
import { SqliteQueueAdapter } from '../sqlite-queue-adapter.js';

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => {
    throw new Error('Database opened without a host-selected path');
  }),
}));

describe('host-owned SQLite database path', () => {
  it.each([
    ['storage', SqliteStorageAdapter],
    ['queue', SqliteQueueAdapter],
  ])('%s refuses an omitted path before opening a database', (_name, Adapter) => {
    expect(() => new Adapter(undefined as never)).toThrow('dbPath');
    expect(DatabaseConstructor).not.toHaveBeenCalled();
  });
});
