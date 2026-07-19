import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { createFileSystemMemoryStore } from '../../memory/file-system-memory-store.js';
import { loadContext } from '../context-loader.js';

import type { IMemoryStore, IStartupMemory } from '../../memory/types.js';

const TMP_BASE = join(tmpdir(), `robota-context-loader-memory-${process.pid}`);

function makeWorkspace(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

/**
 * SELFHOST-008 TC-03 — the memory adapter is threaded through the session assembly and consumed by
 * startup-memory injection; with NO adapter injected the neutral fs reference adapter is the default.
 */
describe('SELFHOST-008 TC-03 — loadContext memory-port threading + adapter-gating', () => {
  it('consumes an INJECTED IMemoryStore for startup memory', async () => {
    const injected: IMemoryStore = {
      loadStartupMemory: async (): Promise<IStartupMemory> => ({
        content: 'INJECTED-MEMORY-CONTENT',
        path: '/virtual',
        lineCount: 1,
        truncated: false,
      }),
      list: async () => ({ indexPath: '/virtual', topicsPath: '/virtual/topics', topics: [] }),
      readTopic: async () => '',
      append: async (input) => ({
        indexPath: '/virtual',
        topicPath: '/virtual/topics/x.md',
        topic: input.topic,
        deduplicated: false,
      }),
      recall: async () => ({ content: '', references: [], truncated: false }),
      getPending: async () => undefined,
      listPending: async () => [],
      markPending: async (id, status, reason) => ({
        id,
        type: 'project',
        topic: 't',
        text: 'x',
        sourceMessageIds: [],
        confidence: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
        reason,
        status,
        updatedAt: '2026-07-18T00:00:00.000Z',
      }),
      upsertPending: async () => undefined,
    };

    const context = await loadContext(makeWorkspace(), injected);
    expect(context.memoryMd).toBe('INJECTED-MEMORY-CONTENT');
  });

  it('DEFAULTS to the neutral fs reference adapter when NO store is injected (memory works unchanged)', async () => {
    const cwd = makeWorkspace();
    // seed durable memory on disk via the same neutral fs adapter the default path uses
    await createFileSystemMemoryStore(cwd).append({
      type: 'project',
      topic: 'build',
      text: 'default-fs-memory-entry',
    });

    const context = await loadContext(cwd); // no memoryStore → fs reference adapter default
    expect(context.memoryMd).toContain('default-fs-memory-entry');
  });

  it('returns undefined memoryMd when the default fs store has no memory', async () => {
    const context = await loadContext(makeWorkspace());
    expect(context.memoryMd).toBeUndefined();
  });
});
