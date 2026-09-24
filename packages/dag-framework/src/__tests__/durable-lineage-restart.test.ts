import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InMemoryQueuePort } from '@robota-sdk/dag-adapters-local';
import type { IDagDefinition, IDagExecutionLineage, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { createCompositeInstantNodeDefinition } from '@robota-sdk/dag-node-instant-node';
import { expect, it, vi } from 'vitest';
import { createDagFramework } from '../create-dag-framework.js';

it('reconstructed worker keeps a child run’s persisted depth and ancestors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-child-lineage-'));
  const queue = new InMemoryQueuePort();
  const lineage: IDagExecutionLineage = {
    rootRunId: 'root-run',
    parentRunId: 'parent-run',
    depth: 2,
    maxDepth: 2,
    ancestorCompositeNodeTypes: ['first', 'second'],
  };
  const observed: IDagExecutionLineage[] = [];
  const node: IDagNodeDefinition = {
    nodeType: 'lineage-observer', displayName: 'Lineage observer', category: 'test',
    inputs: [], outputs: [], configSchemaDefinition: null,
    taskHandler: {
      execute: async (_input, context) => {
        if (context.lineage) observed.push(context.lineage);
        return { ok: true, value: {} };
      },
    },
  };
  const definition: IDagDefinition = {
    dagId: 'child', version: 1, status: 'published',
    nodes: [{ nodeId: 'n', nodeType: node.nodeType, dependsOn: [], config: {} }], edges: [],
  };
  const options = {
    executionRoot: root, nodes: [node],
    paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
    ports: { queue },
  };
  let first = await createDagFramework(options);
  try {
    await first.internals.storage.saveDefinition(definition);
    const started = await first.internals.execution.runOrchestrator.startRun({
      dagId: definition.dagId, version: 1, trigger: 'manual', input: {}, lineage,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await first.stop();

    // A new framework owns a new storage adapter and lifecycle executor. Only the queued task
    // and persisted run survive, so a constructor-captured lineage cannot rescue this worker.
    const second = await createDagFramework(options);
    try {
      expect((await second.internals.storage.getDagRun(started.value.dagRunId))?.lineage).toEqual(lineage);
      await second.start();
      const deadline = Date.now() + 5_000;
      let run = await second.internals.storage.getDagRun(started.value.dagRunId);
      while (run?.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        run = await second.internals.storage.getDagRun(started.value.dagRunId);
      }
      expect(run?.status).toBe('success');
      expect(observed).toEqual([lineage]);
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  {
    name: 'depth',
    lineage: {
      rootRunId: 'root-run', parentRunId: 'parent-run', depth: 2, maxDepth: 2,
      ancestorCompositeNodeTypes: ['first', 'second'],
    },
    innerType: 'input',
    errorCode: 'DAG_TASK_EXECUTION_COMPOSITE_DEPTH_EXCEEDED',
  },
  {
    name: 'ancestry',
    lineage: {
      rootRunId: 'root-run', parentRunId: 'parent-run', depth: 1, maxDepth: 3,
      ancestorCompositeNodeTypes: ['first'],
    },
    innerType: 'first',
    errorCode: 'DAG_TASK_EXECUTION_COMPOSITE_RECURSION',
  },
] as const)('restarted worker enforces composite $name before entering its runner', async (case_) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-child-guard-'));
  const queue = new InMemoryQueuePort();
  const runner = vi.fn(async () => ({ ok: true, outputs: {} }));
  const composite = createCompositeInstantNodeDefinition({
    nodeType: 'third', displayName: 'Third',
    innerDag: {
      dagId: 'grandchild', version: 1, status: 'draft',
      nodes: [{ nodeId: 'inner', nodeType: case_.innerType, dependsOn: [], config: {} }], edges: [],
    },
    exposedInputPort: { key: 'text', mapsTo: { nodeId: 'inner', portKey: 'text' } },
    exposedOutputPorts: [{ key: 'text', mapsTo: { nodeId: 'inner', portKey: 'text' } }],
    runner: { run: runner },
  });
  const options = {
    executionRoot: root, nodes: [composite], ports: { queue },
    paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
  };
  const first = await createDagFramework(options);
  try {
    await first.internals.storage.saveDefinition({
      dagId: 'child', version: 1, status: 'published',
      nodes: [{ nodeId: 'wrapped', nodeType: 'third', dependsOn: [], config: {} }], edges: [],
    });
    const started = await first.internals.execution.runOrchestrator.startRun({
      dagId: 'child', version: 1, trigger: 'manual', input: { text: 'x' },
      lineage: case_.lineage,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await first.stop();
    const second = await createDagFramework(options);
    try {
      await second.start();
      const deadline = Date.now() + 5_000;
      let tasks = await second.internals.storage.listTaskRunsByDagRunId(started.value.dagRunId);
      while (tasks[0]?.status !== 'failed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        tasks = await second.internals.storage.listTaskRunsByDagRunId(started.value.dagRunId);
      }
      expect(tasks).toMatchObject([{ status: 'failed', errorCode: case_.errorCode }]);
      expect(runner).not.toHaveBeenCalled();
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
    await rm(root, { recursive: true, force: true });
  }
});
