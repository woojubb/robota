import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A caller starting a fresh root run may still want to cap composite depth for everything under
 * it, by supplying a root lineage (depth 0, no parent, no ancestors) that only carries `maxDepth`.
 * This must be accepted the same way an absent lineage is — it is not a child run.
 */
it('accepts a root lineage carrying only a depth cap, not just a fully absent lineage', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-root-lineage-')));
  roots.push(root);
  const dag: IDagDefinition = {
    dagId: 'root-lineage-cap', version: 1, status: 'draft',
    nodes: [{ nodeId: 'repeat', nodeType: 'text-repeat', dependsOn: [], config: { times: 1 } }],
    edges: [],
  };
  const provider = new LocalDagRuntimeProvider({
    executionRoot: root,
    lineage: { rootRunId: 'root-run', depth: 0, maxDepth: 2, ancestorCompositeNodeTypes: [] },
  });
  const result = await provider.execute(dag, { text: 'hi' });
  expect(result.errorCode).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(result.outputs).toMatchObject({ 'repeat.text': 'hi' });
});
