import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
} from '@robota-sdk/dag-adapters-local';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { expect, it } from 'vitest';
import { createDagFramework } from '../create-dag-framework.js';

it('admits one of two 0.6-cost siblings through concurrent framework workers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-credit-admission-'));
  const storage = new InMemoryStoragePort();
  const queue = new InMemoryQueuePort();
  const lease = new InMemoryLeasePort();
  let executions = 0;
  const node: IDagNodeDefinition = {
    nodeType: 'costly',
    displayName: 'Costly',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: {
      estimateCost: async () => ({ ok: true, value: { estimatedCredits: 0.6 } }),
      execute: async () => {
        executions += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ok: true, value: { done: true } };
      },
    },
  };
  const common = {
    executionRoot: root,
    nodes: [node],
    ports: { storage, queue, lease },
    paths: { assetRoot: path.join(root, 'assets') },
  };
  const first = await createDagFramework({
    ...common,
    worker: { workerId: 'first' },
    autoStart: true,
  });
  const second = await createDagFramework({
    ...common,
    worker: { workerId: 'second' },
    autoStart: true,
  });
  try {
    const definition: IDagDefinition = {
      dagId: 'siblings',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [
        { nodeId: 'a', nodeType: 'costly', dependsOn: [], config: {} },
        { nodeId: 'b', nodeType: 'costly', dependsOn: [], config: {} },
      ],
      edges: [],
    };
    const created = await first.runs.createRun({ definition });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await first.runs.startRun(created.value.dagRunId);
    const deadline = Date.now() + 5000;
    let tasks = await storage.listTaskRunsByDagRunId(created.value.dagRunId);
    while (
      Date.now() < deadline &&
      tasks.some((task) => !['success', 'failed'].includes(task.status))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tasks = await storage.listTaskRunsByDagRunId(created.value.dagRunId);
    }
    expect(tasks.map((task) => task.status).sort()).toEqual(['failed', 'success']);
    expect(executions).toBe(1);
    expect(tasks.find((task) => task.status === 'success')?.totalCredits).toBe(0.6);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
    await rm(root, { recursive: true, force: true });
  }
});
