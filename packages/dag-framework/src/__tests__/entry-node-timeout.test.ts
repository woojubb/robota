import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import { createDagFramework } from '../create-dag-framework.js';
import type { IDagFramework } from '../types.js';

let tmpDir: string;
let framework: IDagFramework;

/**
 * A node whose executor never resolves on its own, so the only way a task run for it settles is
 * through the worker's timeout path.
 */
const HANGING_NODE: IDagNodeDefinition = {
  nodeType: 'hangs-forever',
  displayName: 'Hangs Forever',
  category: 'test',
  inputs: [],
  outputs: [],
  configSchemaDefinition: null,
  taskHandler: { execute: () => new Promise(() => {}) },
};

// Long enough that the assertion below can tell "failed via its own 200ms timeout" apart from
// "failed via the worker's default", but short enough to keep the suite (and a pre-fix run that
// falls back to this default) fast.
const WORKER_DEFAULT_TIMEOUT_MS = 1_500;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'robota-dag-entry-timeout-'));
  framework = await createDagFramework({
    nodes: [...createDefaultNodeRegistrySync(), HANGING_NODE],
    paths: { storageRoot: path.join(tmpDir, 'storage'), assetRoot: path.join(tmpDir, 'assets') },
    autoStart: true,
    worker: { defaultTimeoutMs: WORKER_DEFAULT_TIMEOUT_MS },
  });
});

afterEach(async () => {
  await framework.stop();
  await rm(tmpDir, { recursive: true, force: true });
});

async function pollRunStatus(fw: IDagFramework, dagRunId: string, timeoutMs = 5_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fw.runs.getRun(dagRunId);
    if (!res.ok) return 'error';
    const dagRun = res.value.dagRun;
    if (dagRun.status === 'success' || dagRun.status === 'failed') {
      return dagRun.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return 'timeout';
}

describe('a root (entry) node with its own configured timeoutMs', () => {
  it('is bound by its own timeout rather than the worker default', async () => {
    const definition: IDagDefinition = {
      dagId: 'e2e-entry-timeout',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'root', nodeType: 'hangs-forever', dependsOn: [], config: {}, timeoutMs: 200 }],
      edges: [],
    };

    const runRes = await framework.runs.createRun({ definition });
    expect(runRes.ok).toBe(true);
    if (!runRes.ok) throw new Error('Expected a created run.');
    const { dagRunId } = runRes.value;

    await framework.runs.startRun(dagRunId);

    const startedAt = Date.now();
    const finalStatus = await pollRunStatus(framework, dagRunId, WORKER_DEFAULT_TIMEOUT_MS * 4);
    const elapsedMs = Date.now() - startedAt;

    expect(finalStatus).toBe('failed');
    // The node's own timeoutMs (200ms) must be what failed this run, not the worker's much
    // larger default — a generous margin above 200ms but comfortably below the default proves
    // it was the node's own budget, not a fallback, that fired.
    expect(elapsedMs).toBeLessThan(WORKER_DEFAULT_TIMEOUT_MS);

    const resultRes = await framework.runs.getRun(dagRunId);
    expect(resultRes.ok).toBe(true);
    if (!resultRes.ok) throw new Error('Expected a run result.');
    const rootTask = resultRes.value.taskRuns.find((task) => task.nodeId === 'root');
    expect(rootTask?.errorCode).toBe('DAG_TASK_EXECUTION_TIMEOUT');
  });

  it('gets the worker default timeout when it configures none of its own', async () => {
    const definition: IDagDefinition = {
      dagId: 'e2e-entry-default-timeout',
      version: 1,
      status: 'draft',
      // No timeoutMs on the node: it must fall back to the worker's own default.
      nodes: [{ nodeId: 'root', nodeType: 'hangs-forever', dependsOn: [], config: {} }],
      edges: [],
    };

    const runRes = await framework.runs.createRun({ definition });
    expect(runRes.ok).toBe(true);
    if (!runRes.ok) throw new Error('Expected a created run.');
    const { dagRunId } = runRes.value;

    await framework.runs.startRun(dagRunId);

    const startedAt = Date.now();
    const finalStatus = await pollRunStatus(framework, dagRunId, WORKER_DEFAULT_TIMEOUT_MS * 4);
    const elapsedMs = Date.now() - startedAt;

    expect(finalStatus).toBe('failed');
    // Without its own timeoutMs, the run can only fail once the worker default elapses — well
    // past the 200ms deadline the other test in this file configures explicitly.
    expect(elapsedMs).toBeGreaterThanOrEqual(WORKER_DEFAULT_TIMEOUT_MS);

    const resultRes = await framework.runs.getRun(dagRunId);
    expect(resultRes.ok).toBe(true);
    if (!resultRes.ok) throw new Error('Expected a run result.');
    const rootTask = resultRes.value.taskRuns.find((task) => task.nodeId === 'root');
    expect(rootTask?.errorCode).toBe('DAG_TASK_EXECUTION_TIMEOUT');
  });
});

describe('a node timeoutMs never leaks into node input', () => {
  it("does not appear as an extra output port on an entry multi-input node with ports: []", async () => {
    const definition: IDagDefinition = {
      dagId: 'e2e-multi-input-no-leak',
      version: 1,
      status: 'draft',
      nodes: [
        {
          nodeId: 'root',
          nodeType: 'multi-input',
          dependsOn: [],
          config: { ports: [], values: {} },
          timeoutMs: 5_000,
        },
      ],
      edges: [],
    };

    const runRes = await framework.runs.createRun({ definition });
    expect(runRes.ok).toBe(true);
    if (!runRes.ok) throw new Error('Expected a created run.');
    const { dagRunId } = runRes.value;

    // A run input that itself has no fields, so the only way `timeoutMs` could show up in the
    // node's output is if it rode the payload as an ordinary input value.
    await framework.runs.startRun(dagRunId);

    const finalStatus = await pollRunStatus(framework, dagRunId);
    expect(finalStatus).toBe('success');

    const resultRes = await framework.runs.getRun(dagRunId);
    expect(resultRes.ok).toBe(true);
    if (!resultRes.ok) throw new Error('Expected a run result.');
    const rootTask = resultRes.value.taskRuns.find((task) => task.nodeId === 'root');
    const output = rootTask?.outputSnapshot ? JSON.parse(rootTask.outputSnapshot) : {};
    expect(output).not.toHaveProperty('timeoutMs');
    expect(String(output._agentSummary)).not.toContain('timeoutMs');
  });

  it('does not satisfy an entry transform node\'s empty-input requirement', async () => {
    const definition: IDagDefinition = {
      dagId: 'e2e-transform-no-leak',
      version: 1,
      status: 'draft',
      nodes: [
        {
          nodeId: 'root',
          nodeType: 'transform',
          dependsOn: [],
          config: {},
          timeoutMs: 5_000,
        },
      ],
      edges: [],
    };

    const runRes = await framework.runs.createRun({ definition, input: {} });
    expect(runRes.ok).toBe(true);
    if (!runRes.ok) throw new Error('Expected a created run.');
    const { dagRunId } = runRes.value;

    await framework.runs.startRun(dagRunId);

    const finalStatus = await pollRunStatus(framework, dagRunId);
    expect(finalStatus).toBe('failed');

    const resultRes = await framework.runs.getRun(dagRunId);
    expect(resultRes.ok).toBe(true);
    if (!resultRes.ok) throw new Error('Expected a run result.');
    const rootTask = resultRes.value.taskRuns.find((task) => task.nodeId === 'root');
    // If timeoutMs had leaked into the node's input, `Object.keys(input).length` would be 1
    // instead of 0 and this validation would never fire.
    expect(rootTask?.errorCode).toBe('DAG_VALIDATION_TRANSFORM_INPUT_REQUIRED');
  });
});
