import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';
import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('rejects a parallel child when sibling estimates exceed their shared root limit', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-root-credits-')));
  roots.push(root);
  const costly: IDagNodeDefinition = {
    nodeType: 'costly',
    displayName: 'Costly',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: {
      estimateCost: async () => ({ ok: true, value: { estimatedCredits: 0.75 } }),
      execute: async () => ({ ok: true, value: { done: true } }),
    },
  };
  const childDag: IDagDefinition = {
    dagId: 'child',
    version: 1,
    status: 'draft',
    costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
    nodes: [{ nodeId: 'n', nodeType: 'costly', dependsOn: [], config: {} }],
    edges: [],
  };
  const parent: IDagNodeDefinition = {
    nodeType: 'parent',
    displayName: 'Parent',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: {
      execute: async (_input, context) => {
        const childOptions = {
          executionRoot: root,
          nodeRegistry: [costly],
          snapshotBudget: context.snapshotBudget,
          rootCreditBudget: context.rootCreditBudget,
        };
        const children = await Promise.all([
          new LocalDagRuntimeProvider(childOptions).execute(childDag, {}),
          new LocalDagRuntimeProvider(childOptions).execute(childDag, {}),
        ]);
        return {
          ok: true,
          value: {
            accepted: children.filter((child) => child.ok).length,
            errors: children.filter((child) => !child.ok).map((child) => child.errorCode ?? ''),
          },
        };
      },
    },
  };
  const provider = new LocalDagRuntimeProvider({ executionRoot: root, nodeRegistry: [parent] });
  const result = await provider.execute(
    {
      dagId: 'root',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'parent', dependsOn: [], config: {} }],
      edges: [],
    },
    {},
  );
  expect(result.ok).toBe(true);
  expect(result.outputs).toMatchObject({
    'n.accepted': 1,
    'n.errors': ['DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED'],
  });
});

it('keeps child run totals local when earlier siblings spent root credits', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-child-credits-')));
  roots.push(root);
  const charge = (nodeType: string, credits: number): IDagNodeDefinition => ({
    nodeType,
    displayName: nodeType,
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: {
      estimateCost: async () => ({ ok: true, value: { estimatedCredits: credits } }),
      execute: async () => ({ ok: true, value: { done: true } }),
    },
  });
  const firstChild: IDagDefinition = {
    dagId: 'first-child',
    version: 1,
    status: 'draft',
    costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
    nodes: [{ nodeId: 'a', nodeType: 'large', dependsOn: [], config: {} }],
    edges: [],
  };
  const secondChild: IDagDefinition = {
    dagId: 'second-child',
    version: 1,
    status: 'draft',
    costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
    nodes: [
      { nodeId: 'a', nodeType: 'small', dependsOn: [], config: {} },
      { nodeId: 'b', nodeType: 'small', dependsOn: ['a'], config: {} },
    ],
    edges: [],
  };
  const parent: IDagNodeDefinition = {
    nodeType: 'parent',
    displayName: 'Parent',
    category: 'test',
    inputs: [],
    outputs: [],
    configSchemaDefinition: null,
    taskHandler: {
      execute: async (_input, context) => {
        const options = {
          executionRoot: root,
          nodeRegistry: [charge('large', 0.75), charge('small', 0.2)],
          snapshotBudget: context.snapshotBudget,
          rootCreditBudget: context.rootCreditBudget,
        };
        const first = await new LocalDagRuntimeProvider(options).execute(firstChild, {});
        const second = await new LocalDagRuntimeProvider(options).execute(secondChild, {});
        return {
          ok: true,
          value: { first: first.ok, second: second.ok, secondError: second.errorCode ?? '' },
        };
      },
    },
  };
  const result = await new LocalDagRuntimeProvider({
    executionRoot: root,
    nodeRegistry: [parent],
  }).execute(
    {
      dagId: 'root-local',
      version: 1,
      status: 'draft',
      costPolicy: { runCreditLimit: 2, costPolicyVersion: 1 },
      nodes: [{ nodeId: 'n', nodeType: 'parent', dependsOn: [], config: {} }],
      edges: [],
    },
    {},
  );
  expect(result.ok).toBe(true);
  expect(result.outputs).toMatchObject({ 'n.first': true, 'n.second': true, 'n.secondError': '' });
});
