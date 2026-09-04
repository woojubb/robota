import { mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { createWorkspaceMemoryStore } from '../../memory/file-system-memory-store.js';
import {
  createTrustedProjectAccessFixture,
  createTrustedProjectStateFixture,
} from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectReader } from '../../workspace-trust/index.js';
import { loadContext } from '../context-loader.js';

import type { IMemoryStore, IStartupMemory } from '../../memory/types.js';

const TMP_BASE = mkdtempSync(join(tmpdir(), 'robota-context-loader-memory-'));

function makeWorkspace(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function projectSource(root: string) {
  const access = await createTrustedProjectAccessFixture(root);
  if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
  return { reader: getWorkspaceProjectReader(access.authority) };
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

/**
 * SELFHOST-008 TC-03 — the memory adapter is threaded through the session assembly and consumed by
 * startup-memory injection; with NO adapter injected, project state remains inaccessible.
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

    const context = await loadContext(undefined, injected);
    expect(context.memoryMd).toBe('INJECTED-MEMORY-CONTENT');
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'does not discover project memory from cwd when no store is injected',
    async () => {
      const cwd = makeWorkspace();
      const store = createWorkspaceMemoryStore(
        await createTrustedProjectStateFixture(cwd, 'memory'),
      );
      await store.append({
        type: 'project',
        topic: 'build',
        text: 'authority-required-memory-entry',
      });

      const context = await loadContext(await projectSource(cwd));
      expect(context.memoryMd).toBeUndefined();
    },
  );

  it('returns undefined memoryMd when no store is injected', async () => {
    const context = await loadContext(undefined);
    expect(context.memoryMd).toBeUndefined();
  });
});
