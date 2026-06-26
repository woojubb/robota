import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLogStorage } from '../file-storage';
import type { ILogEntry } from '../../types';

function makeEntry(message: string): ILogEntry {
  return {
    timestamp: new Date('2026-06-01T00:00:00.000Z'),
    level: 'info',
    message,
  };
}

describe('FileLogStorage (PLUGIN-001: real persistence)', () => {
  let dir: string;
  let filePath: string;

  function freshStorage(): FileLogStorage {
    dir = mkdtempSync(join(tmpdir(), 'robota-log-'));
    filePath = join(dir, 'app.log');
    return new FileLogStorage(filePath);
  }

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('appends each entry as a line to the file', async () => {
    const storage = freshStorage();
    await storage.write(makeEntry('first'));
    await storage.write(makeEntry('second'));
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('second');
  });

  it('flush/close resolve (write-through, nothing buffered)', async () => {
    const storage = freshStorage();
    await storage.write(makeEntry('x'));
    await expect(storage.flush()).resolves.toBeUndefined();
    await expect(storage.close()).resolves.toBeUndefined();
  });
});
