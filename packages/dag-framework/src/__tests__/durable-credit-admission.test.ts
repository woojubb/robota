import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
} from '@robota-sdk/dag-adapters-local';
import type { IDagDefinition, IDagNodeDefinition, TExecutionCommit } from '@robota-sdk/dag-core';
import { expect, it } from 'vitest';
import { createDagFramework } from '../create-dag-framework.js';

it('settles a cost-limited run with a public custom executor', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-custom-credit-'));
  const node: IDagNodeDefinition = {
    nodeType: 'custom',
    displayName: 'Custom',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: { execute: async () => ({ ok: true, value: {} }) },
  };
  const framework = await createDagFramework({
    executionRoot: root,
    nodes: [node],
    autoStart: true,
    paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
    ports: {
      executor: {
        estimateCost: async () => ({ ok: true, value: 0.4 }),
        execute: async (input) => {
          expect(
            (await framework.internals.storage.getTaskRun(input.taskRunId))?.reservedCredits,
          ).toBe(0.4);
          return { ok: true, output: { done: true }, estimatedCredits: 0.4 };
        },
      },
    },
  });
  try {
    const definition: IDagDefinition = {
      dagId: 'custom',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'custom', dependsOn: [], config: {} }],
      edges: [],
    };
    const created = await framework.runs.createRun({ definition });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await framework.runs.startRun(created.value.dagRunId);
    const deadline = Date.now() + 5000;
    let tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    while (
      Date.now() < deadline &&
      tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    }
    expect(tasks).toMatchObject([{ status: 'success', estimatedCredits: 0.4, totalCredits: 0.4 }]);
  } finally {
    await framework.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('fails a cost-limited custom executor without preflight estimation before execution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-custom-credit-missing-'));
  let executions = 0;
  const node: IDagNodeDefinition = {
    nodeType: 'custom',
    displayName: 'Custom',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: { execute: async () => ({ ok: true, value: {} }) },
  };
  const framework = await createDagFramework({
    executionRoot: root,
    nodes: [node],
    autoStart: true,
    paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
    ports: {
      executor: {
        execute: async () => {
          executions += 1;
          return { ok: true, output: {}, estimatedCredits: 0.4 };
        },
      },
    },
  });
  try {
    const definition: IDagDefinition = {
      dagId: 'custom',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'custom', dependsOn: [], config: {} }],
      edges: [],
    };
    const created = await framework.runs.createRun({ definition });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await framework.runs.startRun(created.value.dagRunId);
    const deadline = Date.now() + 5000;
    let tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    while (
      Date.now() < deadline &&
      tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    }
    expect(tasks).toMatchObject([
      { status: 'failed', errorCode: 'DAG_VALIDATION_CREDIT_ESTIMATE_REQUIRED' },
    ]);
    expect(executions).toBe(0);
  } finally {
    await framework.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('shares one task timeout across custom estimation and execution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-custom-credit-deadline-'));
  const node: IDagNodeDefinition = {
    nodeType: 'custom',
    displayName: 'Custom',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: { execute: async () => ({ ok: true, value: {} }) },
  };
  const framework = await createDagFramework({
    executionRoot: root,
    nodes: [node],
    autoStart: true,
    worker: { defaultTimeoutMs: 60 },
    paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
    ports: {
      executor: {
        estimateCost: async () => {
          await new Promise((resolve) => setTimeout(resolve, 45));
          return { ok: true, value: 0.4 };
        },
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 45));
          return { ok: true, output: {}, estimatedCredits: 0.4 };
        },
      },
    },
  });
  try {
    const definition: IDagDefinition = {
      dagId: 'custom',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'custom', dependsOn: [], config: {} }],
      edges: [],
    };
    const created = await framework.runs.createRun({ definition });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await framework.runs.startRun(created.value.dagRunId);
    const deadline = Date.now() + 5000;
    let tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    while (
      Date.now() < deadline &&
      tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    }
    expect(tasks).toMatchObject([{ status: 'failed', errorCode: 'DAG_TASK_EXECUTION_TIMEOUT' }]);
    expect(tasks[0].reservedCredits).toBeUndefined();
  } finally {
    await framework.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('times out an estimator that ignores cancellation without executing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-custom-estimate-hang-'));
  let executions = 0;
  const node: IDagNodeDefinition = {
    nodeType: 'custom',
    displayName: 'Custom',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: { execute: async () => ({ ok: true, value: {} }) },
  };
  const framework = await createDagFramework({
    executionRoot: root,
    nodes: [node],
    autoStart: true,
    worker: { defaultTimeoutMs: 40 },
    paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
    ports: {
      executor: {
        estimateCost: async () => new Promise<never>(() => undefined),
        execute: async () => {
          executions += 1;
          return { ok: true, output: {}, estimatedCredits: 0.4 };
        },
      },
    },
  });
  try {
    const definition: IDagDefinition = {
      dagId: 'custom',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'custom', dependsOn: [], config: {} }],
      edges: [],
    };
    const created = await framework.runs.createRun({ definition });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await framework.runs.startRun(created.value.dagRunId);
    const deadline = Date.now() + 5000;
    let tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    while (
      Date.now() < deadline &&
      tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    }
    expect(tasks).toMatchObject([{ status: 'failed', errorCode: 'DAG_TASK_EXECUTION_TIMEOUT' }]);
    expect(executions).toBe(0);
  } finally {
    await framework.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('releases a custom executor hold when its reported cost changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-custom-credit-mismatch-'));
  const node: IDagNodeDefinition = {
    nodeType: 'custom',
    displayName: 'Custom',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: { execute: async () => ({ ok: true, value: {} }) },
  };
  const framework = await createDagFramework({
    executionRoot: root,
    nodes: [node],
    autoStart: true,
    paths: { storageRoot: path.join(root, 'storage'), assetRoot: path.join(root, 'assets') },
    ports: {
      executor: {
        estimateCost: async () => ({ ok: true, value: 0.4 }),
        execute: async () => ({ ok: true, output: {}, estimatedCredits: 0.5 }),
      },
    },
  });
  try {
    const definition: IDagDefinition = {
      dagId: 'custom',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'custom', dependsOn: [], config: {} }],
      edges: [],
    };
    const created = await framework.runs.createRun({ definition });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await framework.runs.startRun(created.value.dagRunId);
    const deadline = Date.now() + 5000;
    let tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    while (
      Date.now() < deadline &&
      tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tasks = await framework.internals.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    }
    expect(tasks).toMatchObject([
      { status: 'failed', errorCode: 'DAG_VALIDATION_CREDIT_ESTIMATE_MISMATCH' },
    ]);
    expect(tasks[0].reservedCredits).toBeUndefined();
  } finally {
    await framework.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('fails a current attempt when successful settlement is rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-credit-settle-reject-'));
  class RejectSuccessStorage extends InMemoryStoragePort {
    public override async commitExecution(dagRunId: string, mutation: TExecutionCommit) {
      if (mutation.kind === 'settle' && mutation.status === 'success') return { applied: false };
      return super.commitExecution(dagRunId, mutation);
    }
  }
  const storage = new RejectSuccessStorage();
  const node: IDagNodeDefinition = {
    nodeType: 'custom',
    displayName: 'Custom',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: { execute: async () => ({ ok: true, value: {} }) },
  };
  const framework = await createDagFramework({
    executionRoot: root,
    nodes: [node],
    autoStart: true,
    paths: { assetRoot: path.join(root, 'assets') },
    ports: {
      storage,
      executor: {
        estimateCost: async () => ({ ok: true, value: 0.4 }),
        execute: async () => ({ ok: true, output: {}, estimatedCredits: 0.4 }),
      },
    },
  });
  try {
    const definition: IDagDefinition = {
      dagId: 'custom',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'custom', dependsOn: [], config: {} }],
      edges: [],
    };
    const created = await framework.runs.createRun({ definition });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await framework.runs.startRun(created.value.dagRunId);
    const deadline = Date.now() + 5000;
    let tasks = await storage.listTaskRunsByDagRunId(created.value.dagRunId);
    while (
      Date.now() < deadline &&
      tasks.some((task) => task.status === 'queued' || task.status === 'running')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tasks = await storage.listTaskRunsByDagRunId(created.value.dagRunId);
    }
    expect(tasks).toMatchObject([
      { status: 'failed', errorCode: 'DAG_VALIDATION_EXECUTION_SETTLEMENT_REJECTED' },
    ]);
    expect(tasks[0].reservedCredits).toBeUndefined();
  } finally {
    await framework.stop();
    await rm(root, { recursive: true, force: true });
  }
});

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
