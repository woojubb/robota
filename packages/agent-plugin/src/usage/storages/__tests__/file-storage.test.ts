import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileUsageStorage } from '../file-storage';
import type { IUsageStats } from '../../types';

function makeStat(overrides: Partial<IUsageStats> = {}): IUsageStats {
  return {
    conversationId: 'conv-1',
    timestamp: new Date('2026-06-01T00:00:00.000Z'),
    provider: 'openai',
    model: 'gpt',
    tokensUsed: { input: 10, output: 5, total: 15 },
    requestCount: 1,
    duration: 100,
    success: true,
    ...overrides,
  };
}

describe('FileUsageStorage (PLUGIN-001: real persistence)', () => {
  let dir: string;

  function freshStorage(): FileUsageStorage {
    dir = mkdtempSync(join(tmpdir(), 'robota-usage-'));
    return new FileUsageStorage(join(dir, 'usage.json'));
  }

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('saves and reads back stats with revived timestamps', async () => {
    const storage = freshStorage();
    await storage.save(makeStat());
    const all = await storage.getStats();
    expect(all).toHaveLength(1);
    expect(all[0]!.timestamp).toBeInstanceOf(Date);
    expect(all[0]!.tokensUsed.total).toBe(15);
  });

  it('filters by conversationId and time range', async () => {
    const storage = freshStorage();
    await storage.save(makeStat({ conversationId: 'a' }));
    await storage.save(makeStat({ conversationId: 'b' }));
    await storage.save(
      makeStat({ conversationId: 'a', timestamp: new Date('2026-01-01T00:00:00.000Z') }),
    );

    expect(await storage.getStats('a')).toHaveLength(2);
    const ranged = await storage.getStats('a', {
      start: new Date('2026-05-01T00:00:00.000Z'),
      end: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(ranged).toHaveLength(1);
  });

  it('clears all stats; flush/close resolve (write-through)', async () => {
    const storage = freshStorage();
    await storage.save(makeStat());
    await storage.clear();
    expect(await storage.getStats()).toEqual([]);
    await expect(storage.flush()).resolves.toBeUndefined();
    await expect(storage.close()).resolves.toBeUndefined();
  });
});
