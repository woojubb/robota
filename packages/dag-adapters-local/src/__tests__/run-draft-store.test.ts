import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IRunDraft } from '@robota-sdk/dag-core';
import { FileRunDraftStore, InMemoryRunDraftStore } from '../index.js';

function createDraft(overrides: Partial<IRunDraft> = {}): IRunDraft {
  return {
    draftId: 'draft-1',
    definition: {
      dagId: 'dag-1',
      version: 1,
      status: 'draft',
      nodes: [
        {
          nodeId: 'source',
          nodeType: 'input',
          dependsOn: [],
          config: {},
        },
      ],
      edges: [],
    },
    input: { prompt: 'hello' },
    nodeStateMap: {
      source: {
        operationStatus: 'idle',
        executionStatus: 'success',
        trace: {
          nodeId: 'source',
          output: { text: 'hello' },
        },
      },
    },
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:01.000Z',
    ...overrides,
  };
}

describe('run draft stores', () => {
  it('stores, lists, and deletes drafts in memory', async () => {
    const store = new InMemoryRunDraftStore();
    const draft = createDraft();

    await store.saveRunDraft(draft);
    await store.saveRunDraft(
      createDraft({
        draftId: 'draft-2',
        updatedAt: '2026-05-05T00:00:02.000Z',
      }),
    );

    expect(await store.getRunDraft('draft-1')).toEqual(draft);
    expect((await store.listRunDrafts()).map((item) => item.draftId)).toEqual([
      'draft-2',
      'draft-1',
    ]);

    await store.deleteRunDraft('draft-1');
    expect(await store.getRunDraft('draft-1')).toBeUndefined();
  });

  it('persists drafts on the filesystem', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'robota-run-drafts-'));
    try {
      const draft = createDraft();
      const writer = new FileRunDraftStore(root);
      await writer.saveRunDraft(draft);

      const reader = new FileRunDraftStore(root);
      expect(await reader.getRunDraft('draft-1')).toEqual(draft);
      expect((await reader.listRunDrafts()).map((item) => item.draftId)).toEqual(['draft-1']);

      await reader.deleteRunDraft('draft-1');
      expect(await reader.getRunDraft('draft-1')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
