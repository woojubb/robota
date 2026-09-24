import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { FileStoragePort } from '@robota-sdk/dag-adapters-local';
import { createDagFramework } from '../create-dag-framework.js';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import * as defaultRegistryLoader from '../load-default-node-registry.js';
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
    const res = await fw.runs.getRun(dagRunId);
    if (!res.ok) return 'error';
    const dagRun = res.value.dagRun;
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

    const runRes = await framework.runs.createRun({ definition });
    expect(runRes.ok).toBe(true);
    expect(runRes).not.toHaveProperty('status');

    if (!runRes.ok) throw new Error('Expected a created run.');
    const { dagRunId } = runRes.value;
    expect(typeof dagRunId).toBe('string');

    await framework.runs.startRun(dagRunId);

    const finalStatus = await pollRunStatus(framework, dagRunId);
    expect(finalStatus).toBe('success');

    const resultRes = await framework.runs.getRun(dagRunId);
    expect(resultRes.ok).toBe(true);
    if (!resultRes.ok) throw new Error('Expected a run result.');
    const taskRuns = resultRes.value.taskRuns;
    expect(taskRuns.length).toBeGreaterThanOrEqual(2);
  });
});

describe('default skill discovery boundary', () => {
  it('forwards host sources and ordered roots into the async default catalog loader', async () => {
    const contributionSources = [
      {
        kind: 'host' as const,
        displayName: 'host fixture',
        readText: () => undefined,
        listDirectory: () => [],
        inspectKind: () => undefined,
      },
    ];
    const skillRoots = [{ root: 'custom/skills', kind: 'skills' as const }];
    const loader = vi.spyOn(defaultRegistryLoader, 'loadDefaultNodeRegistry');
    const created = await createDagFramework({
      executionRoot: tmpDir,
      providers: [],
      contributionSources,
      skillRoots,
      paths: {
        storageRoot: path.join(tmpDir, 'host-skill-storage'),
        assetRoot: path.join(tmpDir, 'host-skill-assets'),
      },
    });

    try {
      expect(loader).toHaveBeenCalledWith([], skillRoots, contributionSources);
    } finally {
      loader.mockRestore();
      await created.stop();
    }
  });
});

describe('host-owned persistence paths', () => {
  it('accepts host-supplied storage and asset ports without paths', async () => {
    const created = await createDagFramework({
      nodes: [],
      ports: { storage: framework.internals.storage, assetStore: framework.assets },
    });
    try {
      expect(created.internals.storage).toBe(framework.internals.storage);
      expect(created.assets).toBe(framework.assets);
    } finally {
      await created.stop();
    }
  });

  it('stop() leaves a caller-supplied FileStoragePort open', async () => {
    const storage = new FileStoragePort(path.join(tmpDir, 'caller-storage'));
    const created = await createDagFramework({
      nodes: [],
      ports: { storage, assetStore: framework.assets },
    });
    await created.stop();
    try {
      await expect(storage.listDagRuns()).resolves.toEqual([]);
    } finally {
      await storage.close();
    }
  });

  it('refuses to compose storage from the process environment when the host omits its path', async () => {
    vi.stubEnv('DAG_STORAGE_ROOT', path.join(tmpDir, 'ambient-storage'));
    try {
      await expect(
        createDagFramework({ nodes: [], paths: { assetRoot: path.join(tmpDir, 'assets') } }),
      ).rejects.toThrow('storageRoot');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses to compose assets from the process environment when the host omits its path', async () => {
    vi.stubEnv('ASSET_STORAGE_ROOT', path.join(tmpDir, 'ambient-assets'));
    try {
      await expect(
        createDagFramework({ nodes: [], paths: { storageRoot: path.join(tmpDir, 'storage') } }),
      ).rejects.toThrow('assetRoot');
    } finally {
      vi.unstubAllEnvs();
    }
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

    const runRes = await framework.runs.createRun({ definition });
    expect(runRes.ok).toBe(true);

    if (!runRes.ok) throw new Error('Expected a created run.');
    const { dagRunId } = runRes.value;

    await framework.runs.startRun(dagRunId);

    const finalStatus = await pollRunStatus(framework, dagRunId);
    expect(finalStatus).toBe('success');
  });
});

describe('the default composition has no dead-letter reinject capability', () => {
  it('reports the absent capability as absent, not as an empty queue (CORE-027)', async () => {
    // `{ ok: true, reinjected: false }` was "the DLQ is empty" — a claim about a queue this
    // composition does not have, read by an operator draining a DLQ after an incident.
    const { NoopDeadLetterReinject } = await import('../create-dag-framework.js');
    const result = await new NoopDeadLetterReinject().reinjectOnce('worker-1', 30_000);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_DLQ_REINJECT_UNSUPPORTED');
    }
  });
});

describe('trusted execution root admission', () => {
  it.each([
    ['', 'non-empty'],
    ['relative/project', 'absolute'],
    [path.join(os.tmpdir(), 'arch010-root-that-does-not-exist'), 'existing'],
  ])(
    'refuses invalid explicit root %p before composition (%s)',
    async (executionRoot, expected) => {
      await expect(createDagFramework({ executionRoot })).rejects.toThrow(expected);
    },
  );
});
