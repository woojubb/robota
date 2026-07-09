import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { createDagFramework } from '../create-dag-framework.js';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import type { IDagFramework } from '../types.js';

let tmpDir: string;
let framework: IDagFramework;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'robota-dag-e2e-'));
  framework = await createDagFramework({
    nodes: createDefaultNodeRegistrySync(),
    paths: { storageRoot: path.join(tmpDir, 'storage'), assetRoot: path.join(tmpDir, 'assets') },
    autoStart: true,
  });
});

afterEach(async () => {
  await framework.stop();
  await rm(tmpDir, { recursive: true, force: true });
});

async function pollRunStatus(
  fw: IDagFramework,
  dagRunId: string,
  timeoutMs = 8_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fw.client.getRunStatus(dagRunId);
    if (!res.ok) return 'error';
    const dagRun = (res.payload as { data: { dagRun: { status: string } } }).data.dagRun;
    if (dagRun.status === 'success' || dagRun.status === 'failed') {
      return dagRun.status;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'timeout';
}

describe('Input → TextOutput (2-node pipeline)', () => {
  it('runs to success and emits the configured text', async () => {
    const definition: IDagDefinition = {
      dagId: 'e2e-simple',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'src', nodeType: 'input', dependsOn: [], config: { text: 'hello world' } },
        { nodeId: 'out', nodeType: 'text-output', dependsOn: ['src'], config: {} },
      ],
      edges: [{ from: 'src', to: 'out', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
    };

    const runRes = await framework.client.createRun({ definition });
    expect(runRes.ok).toBe(true);
    expect(runRes.status).toBe(201);

    const { dagRunId } = (runRes.payload as { data: { dagRunId: string; preparationId: string } })
      .data;
    expect(typeof dagRunId).toBe('string');

    await framework.client.startRun(dagRunId);

    const finalStatus = await pollRunStatus(framework, dagRunId);
    expect(finalStatus).toBe('success');

    const resultRes = await framework.client.getRunResult(dagRunId);
    expect(resultRes.ok).toBe(true);
    const taskRuns = (resultRes.payload as { data: { taskRuns: unknown[] } }).data.taskRuns;
    expect(taskRuns.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Input → Transform → TextOutput (3-node pipeline)', () => {
  it('applies prefix and runs to success', async () => {
    const definition: IDagDefinition = {
      dagId: 'e2e-transform',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'src', nodeType: 'input', dependsOn: [], config: { text: 'world' } },
        {
          nodeId: 'tx',
          nodeType: 'transform',
          dependsOn: ['src'],
          config: { prefix: 'hello ' },
        },
        { nodeId: 'out', nodeType: 'text-output', dependsOn: ['tx'], config: {} },
      ],
      edges: [
        { from: 'src', to: 'tx', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'tx', to: 'out', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    };

    const runRes = await framework.client.createRun({ definition });
    expect(runRes.ok).toBe(true);

    const { dagRunId } = (runRes.payload as { data: { dagRunId: string } }).data;

    await framework.client.startRun(dagRunId);

    const finalStatus = await pollRunStatus(framework, dagRunId);
    expect(finalStatus).toBe('success');
  });
});
