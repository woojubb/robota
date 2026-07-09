import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDagFramework } from '@robota-sdk/dag-framework';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import type { IDagDefinition } from '@robota-sdk/dag-core';

async function pollRunStatus(
  client: Awaited<ReturnType<typeof createDagFramework>>['client'],
  dagRunId: string,
  timeoutMs = 8_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await client.getRunStatus(dagRunId);
    if (!res.ok) return 'error';
    const dagRun = (res.payload as { data: { dagRun: { status: string } } }).data.dagRun;
    if (dagRun.status === 'success' || dagRun.status === 'failed') return dagRun.status;
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'timeout';
}

describe('embedded mode: IDagOrchestrationPort via createDagFramework', () => {
  it('dag_definitions_create → dag_runs_create → dag_runs_status succeeds', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'robota-mcp-e2e-'));
    try {
      const fw = await createDagFramework({
        nodes: createDefaultNodeRegistrySync(),
        paths: {
          storageRoot: path.join(tmpDir, 'storage'),
          assetRoot: path.join(tmpDir, 'assets'),
        },
        autoStart: true,
      });

      const definition: IDagDefinition = {
        dagId: 'mcp-e2e-test',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'src', nodeType: 'input', dependsOn: [], config: { text: 'hello' } },
          { nodeId: 'out', nodeType: 'text-output', dependsOn: ['src'], config: {} },
        ],
        edges: [{ from: 'src', to: 'out', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
      };

      const createRes = await fw.client.createDefinition(definition);
      expect(createRes.ok).toBe(true);

      const runRes = await fw.client.createRun({ definition });
      expect(runRes.ok).toBe(true);
      const { dagRunId } = (runRes.payload as { data: { dagRunId: string } }).data;

      await fw.client.startRun(dagRunId);
      const finalStatus = await pollRunStatus(fw.client, dagRunId);
      expect(finalStatus).toBe('success');

      await fw.stop();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
