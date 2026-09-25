import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('/workflows run executes text-count-lines with skipEmpty semantics', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'workflow-text-count-lines-')));
  roots.push(root);
  vi.stubEnv('HOME', root);
  const text = `${'line\n'.repeat(20_000)}\u00a0\n\ufeff\n`;
  writeFileSync(
    path.join(root, 'workflow.json'),
    JSON.stringify({
      dagId: 'text-count-lines',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text } },
        {
          nodeId: 'count',
          nodeType: 'text-count-lines',
          dependsOn: ['source'],
          config: { skipEmpty: true },
        },
      ],
      edges: [{ from: 'source', to: 'count', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
    }),
  );

  const result = await executeWorkflowsRun(
    'workflow.json',
    await createWorkflowProjectFixture(root),
  );
  expect(result.success).toBe(true);
  expect(result.message.includes('"count.text": "20000"')).toBe(true);
});
