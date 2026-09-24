import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('/workflows shares snapshot allowance between a parent and its saved composite child', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-budget-')));
  roots.push(root);
  vi.stubEnv('HOME', root);
  mkdirSync(join(root, '.workflows/nodes'), { recursive: true });
  writeFileSync(
    join(root, '.workflows/nodes/wrap.node.json'),
    JSON.stringify({
      kind: 'composite',
      nodeType: 'wrap',
      displayName: 'Wrap',
      innerDag: {
        dagId: 'inner',
        version: 1,
        status: 'draft',
        nodes: [{ nodeId: 'a', nodeType: 'input', dependsOn: [], config: { text: 'x' } }],
        edges: [],
      },
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'a', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'text', mapsTo: { nodeId: 'a', portKey: 'text' } }],
    }),
  );
  writeFileSync(
    join(root, 'parent.json'),
    JSON.stringify({
      dagId: 'parent',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
        { nodeId: 'wrapped', nodeType: 'wrap', dependsOn: ['source'], config: {} },
      ],
      edges: [
        { from: 'source', to: 'wrapped', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    }),
  );
  const project = await createWorkflowProjectFixture(root);
  const result = await executeWorkflowsRun('parent.json', project, undefined, [], {
    inputBytes: 1000,
    outputBytes: 130,
  });
  expect(result.success).toBe(false);
  expect(result.message).toContain('Task output snapshot budget exceeded');
  const separateRoot = await executeWorkflowsRun('parent.json', project, undefined, [], {
    inputBytes: 1000,
    outputBytes: 1000,
  });
  expect(separateRoot.success).toBe(true);
});

it('/workflows rejects an oversized unused definition config before node entry', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-budget-')));
  roots.push(root);
  vi.stubEnv('HOME', root);
  writeFileSync(join(root, 'large.json'), JSON.stringify({
    dagId: 'large', version: 1, status: 'draft',
    nodes: [{ nodeId: 'entry', nodeType: 'input', dependsOn: [], config: {
      text: 'would execute', unused: 'x'.repeat(4_000),
    } }],
    edges: [],
  }));
  const project = await createWorkflowProjectFixture(root);
  const result = await executeWorkflowsRun('large.json', project, undefined, [], {
    inputBytes: 1_000, outputBytes: 1_000,
  });
  expect(result.success).toBe(false);
  expect(result.message).toContain('startRun failed');
  expect(result.message).toContain('DAG_TASK_SNAPSHOT_BUDGET_EXCEEDED');
});
