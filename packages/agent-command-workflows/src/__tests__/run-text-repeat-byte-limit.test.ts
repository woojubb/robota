import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('/workflows run rejects text-repeat amplification despite workflow-supplied limits', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'workflow-text-cap-')));
  dirs.push(root);
  vi.stubEnv('HOME', root);
  writeFileSync(path.join(root, 'repeat.json'), JSON.stringify({
    dagId: 'repeat-limit', version: 1, status: 'draft',
    byteLimits: { maxTextRepeatOutputBytes: Number.MAX_SAFE_INTEGER },
    nodes: [
      { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: '😀' } },
      { nodeId: 'repeat', nodeType: 'text-repeat', dependsOn: ['source'], config: {
        times: 1_048_577, byteLimits: { maxTextRepeatOutputBytes: Number.MAX_SAFE_INTEGER },
      } },
    ],
    edges: [{ from: 'source', to: 'repeat', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
  }));
  const result = await executeWorkflowsRun('repeat.json', await createWorkflowProjectFixture(root));
  expect(result.success).toBe(false);
  expect(result.message).toContain('text-repeat output exceeds its UTF-8 byte limit');
});
