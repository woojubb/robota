import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../sqlite-storage-adapter.js';
import type { IDagDefinition, IDagRun, ITaskRun } from '@robota-sdk/dag-core';

function makeDefinition(overrides: Partial<IDagDefinition> = {}): IDagDefinition {
  return {
    dagId: 'dag-1',
    version: 1,
    status: 'draft',
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function makeDagRun(overrides: Partial<IDagRun> = {}): IDagRun {
  return {
    dagRunId: 'run-1',
    dagId: 'dag-1',
    version: 1,
    status: 'created',
    runKey: 'key-1',
    logicalDate: '2026-01-01T00:00:00.000Z',
    trigger: 'manual',
    ...overrides,
  };
}

function makeTaskRun(overrides: Partial<ITaskRun> = {}): ITaskRun {
  return {
    taskRunId: 'task-1',
    dagRunId: 'run-1',
    nodeId: 'node-1',
    status: 'created',
    attempt: 0,
    ...overrides,
  };
}

describe('SqliteStorageAdapter', () => {
  let adapter: SqliteStorageAdapter;

  beforeEach(() => {
    adapter = new SqliteStorageAdapter(':memory:');
  });

  afterEach(() => {
    adapter.close();
  });

  describe('definitions', () => {
    it('saves and retrieves a definition', async () => {
      const def = makeDefinition();
      await adapter.saveDefinition(def);
      const retrieved = await adapter.getDefinition('dag-1', 1);
      expect(retrieved?.dagId).toBe('dag-1');
      expect(retrieved?.version).toBe(1);
    });

    it('returns undefined for missing definition', async () => {
      const result = await adapter.getDefinition('nonexistent', 1);
      expect(result).toBeUndefined();
    });

    it('upserts on duplicate dagId+version', async () => {
      const def = makeDefinition({ status: 'draft' });
      await adapter.saveDefinition(def);
      await adapter.saveDefinition({ ...def, status: 'published' });
      const retrieved = await adapter.getDefinition('dag-1', 1);
      expect(retrieved?.status).toBe('published');
    });

    it('listDefinitions returns all sorted', async () => {
      await adapter.saveDefinition(makeDefinition({ dagId: 'b', version: 1 }));
      await adapter.saveDefinition(makeDefinition({ dagId: 'a', version: 2 }));
      await adapter.saveDefinition(makeDefinition({ dagId: 'a', version: 1 }));
      const list = await adapter.listDefinitions();
      expect(list).toHaveLength(3);
      expect(list[0].dagId).toBe('a');
      expect(list[0].version).toBe(1);
    });

    it('getLatestPublishedDefinition returns highest published version', async () => {
      await adapter.saveDefinition(makeDefinition({ version: 1, status: 'published' }));
      await adapter.saveDefinition(makeDefinition({ version: 2, status: 'published' }));
      await adapter.saveDefinition(makeDefinition({ version: 3, status: 'draft' }));
      const latest = await adapter.getLatestPublishedDefinition('dag-1');
      expect(latest?.version).toBe(2);
    });

    it('deleteDefinition removes the entry', async () => {
      await adapter.saveDefinition(makeDefinition());
      await adapter.deleteDefinition('dag-1', 1);
      expect(await adapter.getDefinition('dag-1', 1)).toBeUndefined();
    });
  });

  describe('dag runs', () => {
    it('creates and retrieves a dag run', async () => {
      const run = makeDagRun();
      await adapter.createDagRun(run);
      const retrieved = await adapter.getDagRun('run-1');
      expect(retrieved?.dagRunId).toBe('run-1');
      expect(retrieved?.status).toBe('created');
    });

    it('getDagRunByRunKey finds by run key', async () => {
      await adapter.createDagRun(makeDagRun({ runKey: 'unique-key' }));
      const result = await adapter.getDagRunByRunKey('unique-key');
      expect(result?.dagRunId).toBe('run-1');
    });

    it('updateDagRunStatus changes status and endedAt', async () => {
      await adapter.createDagRun(makeDagRun());
      await adapter.updateDagRunStatus('run-1', 'success', '2026-01-01T00:01:00.000Z');
      const updated = await adapter.getDagRun('run-1');
      expect(updated?.status).toBe('success');
      expect(updated?.endedAt).toBe('2026-01-01T00:01:00.000Z');
    });

    it('deleteDagRun removes the entry', async () => {
      await adapter.createDagRun(makeDagRun());
      await adapter.deleteDagRun('run-1');
      expect(await adapter.getDagRun('run-1')).toBeUndefined();
    });
  });

  describe('task runs', () => {
    beforeEach(async () => {
      await adapter.createDagRun(makeDagRun());
    });

    it('creates and retrieves a task run', async () => {
      await adapter.createTaskRun(makeTaskRun());
      const retrieved = await adapter.getTaskRun('task-1');
      expect(retrieved?.taskRunId).toBe('task-1');
      expect(retrieved?.status).toBe('created');
    });

    it('listTaskRunsByDagRunId returns matching runs', async () => {
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-1' }));
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-2' }));
      const list = await adapter.listTaskRunsByDagRunId('run-1');
      expect(list).toHaveLength(2);
    });

    it('updateTaskRunStatus sets status and error', async () => {
      await adapter.createTaskRun(makeTaskRun());
      await adapter.updateTaskRunStatus('task-1', 'failed', {
        code: 'SOME_ERROR',
        message: 'it failed',
        category: 'task_execution',
        retryable: false,
      });
      const updated = await adapter.getTaskRun('task-1');
      expect(updated?.status).toBe('failed');
      expect(updated?.errorCode).toBe('SOME_ERROR');
    });

    it('saveTaskRunSnapshots updates snapshot fields', async () => {
      await adapter.createTaskRun(makeTaskRun());
      await adapter.saveTaskRunSnapshots('task-1', '{"in":1}', '{"out":2}', 0.001, 0.002);
      const updated = await adapter.getTaskRun('task-1');
      expect(updated?.inputSnapshot).toBe('{"in":1}');
      expect(updated?.outputSnapshot).toBe('{"out":2}');
      expect(updated?.estimatedCredits).toBeCloseTo(0.001);
    });

    it('incrementTaskAttempt increments attempt counter', async () => {
      await adapter.createTaskRun(makeTaskRun({ attempt: 0 }));
      await adapter.incrementTaskAttempt('task-1');
      await adapter.incrementTaskAttempt('task-1');
      const updated = await adapter.getTaskRun('task-1');
      expect(updated?.attempt).toBe(2);
    });

    it('deleteTaskRunsByDagRunId removes all matching', async () => {
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-1' }));
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-2' }));
      await adapter.deleteTaskRunsByDagRunId('run-1');
      expect(await adapter.listTaskRunsByDagRunId('run-1')).toHaveLength(0);
    });
  });
});
