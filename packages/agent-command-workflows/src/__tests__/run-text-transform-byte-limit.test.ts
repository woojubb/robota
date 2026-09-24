import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

it('/workflows run rejects transform output before concatenating admitted inputs', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'workflow-transform-cap-')));
  vi.stubEnv('HOME', root);
  try {
    writeFileSync(path.join(root, 'transform.json'), JSON.stringify({
      dagId: 'transform-limit', version: 1, status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
        { nodeId: 'repeat', nodeType: 'text-repeat', dependsOn: ['source'], config: {
          times: 4_194_304,
        } },
        { nodeId: 'transform', nodeType: 'transform', dependsOn: ['repeat'], config: {
          prefix: 'x',
        } },
      ],
      edges: [
        { from: 'source', to: 'repeat', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'repeat', to: 'transform', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    }));
    const result = await executeWorkflowsRun(
      'transform.json', await createWorkflowProjectFixture(root),
    );
    expect(result.success).toBe(false);
    expect(result.message).toContain('transform output exceeds its UTF-8 byte limit');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
