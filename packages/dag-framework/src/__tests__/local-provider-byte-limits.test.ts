import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('snapshots a trusted smaller limit through worker and lifecycle into the supported node', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-byte-cap-')));
  roots.push(root);
  const byteLimits = { maxTextRepeatOutputBytes: 3 };
  const provider = new LocalDagRuntimeProvider({ executionRoot: root, byteLimits });
  byteLimits.maxTextRepeatOutputBytes = 1000;
  const dag: IDagDefinition = {
    dagId: 'trusted-cap', version: 1, status: 'draft',
    nodes: [{ nodeId: 'repeat', nodeType: 'text-repeat', dependsOn: [], config: {
      times: 2, maxTextRepeatOutputBytes: 1000, byteLimits: { maxTextRepeatOutputBytes: 1000 },
    } }], edges: [],
  };
  const failure = await provider.execute(dag, { text: 'é' });
  expect(failure.ok).toBe(false);
  expect(failure.errorCode).toBe('DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED');
  expect(failure.outputs).toEqual({});
  expect(failure.errorRetryable).toBe(false);
  dag.nodes[0]!.config = { times: 1 };
  const success = await provider.execute(dag, { text: 'é' });
  expect(success.ok).toBe(true);
  expect(success.outputs).toMatchObject({ 'repeat.text': 'é' });
});
