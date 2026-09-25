import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

it('/workflows run rejects Unicode uppercase expansion before materializing it', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'workflow-upper-cap-')));
  vi.stubEnv('HOME', root);
  try {
    writeFileSync(path.join(root, 'upper.json'), JSON.stringify({
      dagId: 'upper-limit', version: 1, status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'և' } },
        { nodeId: 'repeat', nodeType: 'text-repeat', dependsOn: ['source'], config: {
          times: 1_100_000,
        } },
        { nodeId: 'upper', nodeType: 'text-upper', dependsOn: ['repeat'], config: {} },
      ],
      edges: [
        { from: 'source', to: 'repeat', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'repeat', to: 'upper', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    }));
    const result = await executeWorkflowsRun('upper.json', await createWorkflowProjectFixture(root));
    expect(result.success).toBe(false);
    expect(result.message).toContain('text-upper output exceeds its UTF-8 byte limit');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
