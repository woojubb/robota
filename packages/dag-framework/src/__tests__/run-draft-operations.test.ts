import { describe, expect, it } from 'vitest';
import type { IClockPort, IRunDraftStore } from '@robota-sdk/dag-core';
import { DagFrameworkRunDraftOperations } from '../adapters/run-draft-operations.js';

const clock: IClockPort = {
  nowIso: () => '2026-09-23T00:00:00.000Z',
  nowEpochMs: () => 0,
};

describe('DagFrameworkRunDraftOperations', () => {
  it('returns a typed storage error without exposing the storage path', async () => {
    const store: IRunDraftStore = {
      saveRunDraft: async () => {
        throw new Error('write failed at /private/drafts.json');
      },
      getRunDraft: async () => undefined,
      listRunDrafts: async () => [],
      deleteRunDraft: async () => undefined,
    };
    const operations = new DagFrameworkRunDraftOperations(store, clock);
    const result = await operations.createRunDraft({
      definition: { dagId: 'draft', version: 1, status: 'draft', nodes: [], edges: [] },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUN_DRAFT_STORAGE_ERROR', retryable: true },
    });
    expect(JSON.stringify(result)).not.toContain('/private/drafts.json');
  });
});
