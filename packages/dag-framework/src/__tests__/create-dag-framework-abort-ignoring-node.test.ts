import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { createDagFramework } from '../create-dag-framework.js';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import type { IDagFramework } from '../types.js';

// A node that never reads its abort signal, standing in for a real cooperative-cleanup-averse
// node (e.g. a long-running provider call). It always eventually settles on its own; the point
// is whether the *run* settles at its timeout without waiting for that.
const ABORT_IGNORING_SLEEP_MS = 3000;
const abortIgnoringSleepNode: IDagNodeDefinition = {
  nodeType: 'test-abort-ignoring-sleep',
  displayName: 'Test: abort-ignoring sleep',
  category: 'Test',
  inputs: [],
  outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
  configSchemaDefinition: null,
  taskHandler: {
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, ABORT_IGNORING_SLEEP_MS));
      return { ok: true, value: { text: 'done' } };
    },
  },
};

let tmpDir: string;
let framework: IDagFramework;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'robota-dag-abort-ignoring-'));
  framework = await createDagFramework({
    nodes: [...createDefaultNodeRegistrySync(), abortIgnoringSleepNode],
    paths: { storageRoot: path.join(tmpDir, 'storage'), assetRoot: path.join(tmpDir, 'assets') },
    autoStart: true,
  });
});

afterEach(async () => {
  // stop() does not wait for the abort-ignoring node; its detached sleep ends on its own.
  await framework.stop();
  await rm(tmpDir, { recursive: true, force: true });
});

// createDagFramework's default executor wraps its lifecycle executor in IsolatedRegexTaskExecutor
// purely to isolate the default text-replace regex operation .
// That wrapper's `stopAndWait` must not also join the wrapped node's own completion — this
// composition hosts arbitrary node types, and dag-worker's timeout/cancel contract is that
// ordinary cooperative cleanup is not awaited, only isolation shutdown is. A node that ignores
// its abort signal must not be able to block every other run's timeout, cancel, or
// `framework.stop()` on this composition.
it(
  'settles a run at its node timeout even when that node ignores its abort signal',
  async () => {
    // `timeoutMs` is only forwarded onto a *downstream* dispatch (see
    // dag-worker/src/services/downstream-task-dispatcher.ts) — an entry/root task's timeout
    // falls back to the worker's `defaultTimeoutMs`, so the abort-ignoring node must be
    // downstream of a (fast) entry node to actually exercise its own 200ms timeout.
    const definition: IDagDefinition = {
      dagId: 'abort-ignoring-timeout',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'input', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
        {
          nodeId: 'slow',
          nodeType: 'test-abort-ignoring-sleep',
          dependsOn: ['input'],
          timeoutMs: 200,
          config: {},
        },
      ],
      edges: [],
    };

    const runRes = await framework.runs.createRun({ definition });
    if (!runRes.ok) throw new Error('Expected a created run.');
    const { dagRunId } = runRes.value;

    const start = Date.now();
    await framework.runs.startRun(dagRunId);

    let status: string | undefined;
    while (Date.now() - start < ABORT_IGNORING_SLEEP_MS) {
      const res = await framework.runs.getRun(dagRunId);
      if (res.ok && (res.value.dagRun.status === 'success' || res.value.dagRun.status === 'failed')) {
        status = res.value.dagRun.status;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const elapsedMs = Date.now() - start;

    expect(status).toBe('failed');
    // Well under the node's 3s abort-ignoring sleep — the run must settle at its own 200ms
    // timeout, not wait for that node's cooperative cleanup (there is none).
    expect(elapsedMs).toBeLessThan(1000);
  },
  ABORT_IGNORING_SLEEP_MS + 2000,
);
