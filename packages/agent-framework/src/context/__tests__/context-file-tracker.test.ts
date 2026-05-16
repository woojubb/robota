import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  computeContentHash,
  loadFileWithHash,
  checkContextStaleness,
  refreshContextEntries,
} from '../context-file-tracker.js';
import type { IContextFileEntry } from '../context-file-tracker.js';

const testDir = join(tmpdir(), `ctx-file-tracker-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('computeContentHash', () => {
  it('returns a non-empty hex string', () => {
    const hash = computeContentHash('hello world');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for identical content', () => {
    const a = computeContentHash('same content');
    const b = computeContentHash('same content');
    expect(a).toBe(b);
  });

  it('returns different hashes for different content', () => {
    const a = computeContentHash('content A');
    const b = computeContentHash('content B');
    expect(a).not.toBe(b);
  });

  it('returns consistent hash for empty string', () => {
    const hash = computeContentHash('');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('loadFileWithHash', () => {
  it('returns an entry with filePath, content, and contentHash', () => {
    const filePath = join(testDir, 'test.md');
    const content = '# Test\n\nHello world.';
    writeFileSync(filePath, content, 'utf-8');

    const entry = loadFileWithHash(filePath);
    expect(entry.filePath).toBe(filePath);
    expect(entry.content).toBe(content);
    expect(entry.contentHash).toBe(computeContentHash(content));
  });

  it('hash matches content hash', () => {
    const filePath = join(testDir, 'agents.md');
    const content = '# AGENTS.md\n\nSome instructions.';
    writeFileSync(filePath, content, 'utf-8');

    const entry = loadFileWithHash(filePath);
    expect(entry.contentHash).toBe(computeContentHash(entry.content));
  });
});

describe('checkContextStaleness', () => {
  it('returns empty arrays when all files are fresh', async () => {
    const filePath = join(testDir, 'fresh.md');
    const content = 'fresh content';
    writeFileSync(filePath, content, 'utf-8');
    const entry: IContextFileEntry = {
      filePath,
      content,
      contentHash: computeContentHash(content),
    };

    const { stale, fresh } = await checkContextStaleness([entry]);
    expect(stale).toHaveLength(0);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].filePath).toBe(filePath);
  });

  it('returns stale entry when file has changed on disk', async () => {
    const filePath = join(testDir, 'stale.md');
    const originalContent = 'original content';
    writeFileSync(filePath, originalContent, 'utf-8');
    const entry: IContextFileEntry = {
      filePath,
      content: originalContent,
      contentHash: computeContentHash(originalContent),
    };

    // Modify the file on disk after we loaded it
    writeFileSync(filePath, 'modified content', 'utf-8');

    const { stale, fresh } = await checkContextStaleness([entry]);
    expect(stale).toHaveLength(1);
    expect(stale[0].filePath).toBe(filePath);
    expect(fresh).toHaveLength(0);
  });

  it('marks file as fresh when file does not exist on disk', async () => {
    const filePath = join(testDir, 'nonexistent.md');
    const entry: IContextFileEntry = {
      filePath,
      content: 'some content',
      contentHash: computeContentHash('some content'),
    };

    const { stale, fresh } = await checkContextStaleness([entry]);
    // File not found on disk — treated as fresh (can't confirm it changed)
    expect(stale).toHaveLength(0);
    expect(fresh).toHaveLength(1);
  });

  it('handles multiple entries correctly', async () => {
    const freshPath = join(testDir, 'fresh.md');
    const stalePath = join(testDir, 'stale.md');
    const freshContent = 'fresh';
    const originalContent = 'original';

    writeFileSync(freshPath, freshContent, 'utf-8');
    writeFileSync(stalePath, originalContent, 'utf-8');

    const entries: IContextFileEntry[] = [
      { filePath: freshPath, content: freshContent, contentHash: computeContentHash(freshContent) },
      {
        filePath: stalePath,
        content: originalContent,
        contentHash: computeContentHash(originalContent),
      },
    ];

    writeFileSync(stalePath, 'changed content', 'utf-8');

    const { stale, fresh } = await checkContextStaleness(entries);
    expect(stale).toHaveLength(1);
    expect(stale[0].filePath).toBe(stalePath);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].filePath).toBe(freshPath);
  });

  it('returns empty arrays for empty input', async () => {
    const { stale, fresh } = await checkContextStaleness([]);
    expect(stale).toHaveLength(0);
    expect(fresh).toHaveLength(0);
  });
});

describe('refreshContextEntries', () => {
  it('returns updated entries for stale files', async () => {
    const filePath = join(testDir, 'refresh.md');
    const originalContent = 'original';
    const updatedContent = 'updated on disk';
    writeFileSync(filePath, originalContent, 'utf-8');

    const entry: IContextFileEntry = {
      filePath,
      content: originalContent,
      contentHash: computeContentHash(originalContent),
    };

    writeFileSync(filePath, updatedContent, 'utf-8');

    const { updated, refreshed } = await refreshContextEntries([entry]);
    expect(refreshed).toContain(filePath);
    const refreshedEntry = updated.find((e) => e.filePath === filePath);
    expect(refreshedEntry?.content).toBe(updatedContent);
    expect(refreshedEntry?.contentHash).toBe(computeContentHash(updatedContent));
  });

  it('keeps fresh entries unchanged', async () => {
    const filePath = join(testDir, 'still-fresh.md');
    const content = 'unchanged content';
    writeFileSync(filePath, content, 'utf-8');

    const entry: IContextFileEntry = {
      filePath,
      content,
      contentHash: computeContentHash(content),
    };

    const { updated, refreshed } = await refreshContextEntries([entry]);
    expect(refreshed).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual(entry);
  });

  it('handles mix of stale and fresh entries', async () => {
    const freshPath = join(testDir, 'keep.md');
    const stalePath = join(testDir, 'update.md');
    writeFileSync(freshPath, 'keep', 'utf-8');
    writeFileSync(stalePath, 'old', 'utf-8');

    const entries: IContextFileEntry[] = [
      { filePath: freshPath, content: 'keep', contentHash: computeContentHash('keep') },
      { filePath: stalePath, content: 'old', contentHash: computeContentHash('old') },
    ];

    writeFileSync(stalePath, 'new', 'utf-8');

    const { updated, refreshed } = await refreshContextEntries(entries);
    expect(refreshed).toEqual([stalePath]);
    expect(updated.find((e) => e.filePath === freshPath)?.content).toBe('keep');
    expect(updated.find((e) => e.filePath === stalePath)?.content).toBe('new');
  });
});
