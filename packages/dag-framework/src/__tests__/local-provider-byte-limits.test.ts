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

it('isolates independent roots while summing each run and task input snapshot', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-snapshot-cap-')));
  roots.push(root);
  const dag: IDagDefinition = {
    dagId: 'snapshot-cap', version: 1, status: 'draft',
    nodes: [{ nodeId: 'repeat', nodeType: 'text-repeat', dependsOn: [], config: { times: 1 } }], edges: [],
  };
  const inputBytes = Buffer.byteLength(JSON.stringify({ ...dag, status: 'published' })) +
    2 * Buffer.byteLength(JSON.stringify({ text: 'x' }));
  const provider = new LocalDagRuntimeProvider({ executionRoot: root, snapshotBudgetLimits: { inputBytes, outputBytes: 1000 } });
  const results = await Promise.all([provider.execute(dag, { text: 'x' }), provider.execute(dag, { text: 'x' })]);
  expect(results.map((result) => result.ok)).toEqual([true, true]);
  const denied = await provider.execute(dag, { text: 'xx' });
  expect(denied.ok).toBe(false);
  expect(denied.outputs).toEqual({});
  expect(denied.errorCode).toBe('DAG_TASK_SNAPSHOT_BUDGET_EXCEEDED');
  expect(denied.errorRetryable).toBe(false);
});

it('preserves structured exhaustion when run snapshots are denied before entry', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-run-snapshot-cap-')));
  roots.push(root);
  const provider = new LocalDagRuntimeProvider({
    executionRoot: root,
    snapshotBudgetLimits: { inputBytes: 10, outputBytes: 1000 },
  });
  const result = await provider.execute({
    dagId: 'oversized', version: 1, status: 'draft',
    nodes: [{ nodeId: 'entry', nodeType: 'input', dependsOn: [], config: { unused: 'x'.repeat(1000) } }],
    edges: [],
  }, {});
  expect(result).toMatchObject({
    ok: false,
    errorCode: 'DAG_TASK_SNAPSHOT_BUDGET_EXCEEDED',
    errorRetryable: false,
  });
});

it('closes the root authority after completion so abandoned descendants cannot admit more snapshots', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-budget-close-')));
  roots.push(root);
  let authority: import('@robota-sdk/dag-core').ITaskSnapshotBudget | undefined;
  const provider = new LocalDagRuntimeProvider({ executionRoot: root, nodeRegistry: [{
    nodeType: 'capture', displayName: 'Capture', category: 'test', inputs: [], outputs: [], configSchemaDefinition: null,
    taskHandler: { execute: async (_input, context) => { authority = context.snapshotBudget; return { ok: true, value: {} }; } },
  }] });
  const result = await provider.execute({ dagId: 'close', version: 1, status: 'draft', nodes: [{ nodeId: 'n', nodeType: 'capture', dependsOn: [], config: {} }], edges: [] }, {});
  expect(result.ok).toBe(true);
  expect(authority).toBeDefined();
  expect(await authority!.admit('output', '{}', async () => ({ applied: true }))).toMatchObject({ ok: false, error: { code: 'DAG_TASK_SNAPSHOT_BUDGET_CLOSED' } });
});

it('does not replace a custom registry handler merely because its nodeType is text-replace', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-custom-regex-')));
  roots.push(root);
  const provider = new LocalDagRuntimeProvider({
    executionRoot: root,
    nodeRegistry: [
      {
        nodeType: 'text-replace',
        displayName: 'Custom',
        category: 'test',
        inputs: [],
        outputs: [],
        configSchemaDefinition: null,
        taskHandler: { execute: async () => ({ ok: true, value: { custom: true } }) },
      },
    ],
  });
  const result = await provider.execute(
    {
      dagId: 'custom',
      version: 1,
      status: 'draft',
      nodes: [
        {
          nodeId: 'n',
          nodeType: 'text-replace',
          dependsOn: [],
          config: { useRegex: true, search: '[' },
        },
      ],
      edges: [],
    },
    {},
  );
  expect(result.ok).toBe(true);
  expect(result.outputs).toEqual({ 'n.custom': true });
});

it('preserves literal text-replace semantics through the product runtime', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-literal-regex-')));
  roots.push(root);
  const provider = new LocalDagRuntimeProvider({ executionRoot: root });
  const result = await provider.execute(
    {
      dagId: 'literal',
      version: 1,
      status: 'draft',
      nodes: [
        {
          nodeId: 'n',
          nodeType: 'text-replace',
          dependsOn: [],
          config: { useRegex: false, search: '[', replacement: 'ok' },
        },
      ],
      edges: [],
    },
    { text: '[[' },
  );
  expect(result.ok).toBe(true);
  expect(result.outputs).toMatchObject({ 'n.text': 'okok' });
});

it('carries an immutable literal replacement limit into the supported node', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-replace-cap-')));
  roots.push(root);
  const byteLimits = { maxTextRepeatOutputBytes: 100, maxTextReplaceOutputBytes: 4 };
  const provider = new LocalDagRuntimeProvider({ executionRoot: root, byteLimits });
  byteLimits.maxTextReplaceOutputBytes = 1000;
  const dag: IDagDefinition = {
    dagId: 'replace-cap', version: 1, status: 'draft', edges: [],
    nodes: [{ nodeId: 'replace', nodeType: 'text-replace', dependsOn: [], config: {
      search: 'x', replacement: 'é', maxTextReplaceOutputBytes: 1000,
    } }],
  };
  expect(await provider.execute(dag, { text: 'xx' })).toMatchObject({ ok: true, outputs: { 'replace.text': 'éé' } });
  expect(await provider.execute(dag, { text: 'xxx' })).toMatchObject({
    ok: false, errorCode: 'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED', errorRetryable: false, outputs: {},
  });
});
