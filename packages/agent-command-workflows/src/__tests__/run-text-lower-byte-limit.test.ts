import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

it('/workflows run rejects Unicode lowercase expansion before materializing it', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'workflow-lower-cap-')));
  vi.stubEnv('HOME', root);
  try {
    writeFileSync(path.join(root, 'lower.json'), JSON.stringify({
      dagId: 'lower-limit', version: 1, status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'İ' } },
        { nodeId: 'repeat', nodeType: 'text-repeat', dependsOn: ['source'], config: {
          times: 1_500_000,
        } },
        { nodeId: 'lower', nodeType: 'text-lower', dependsOn: ['repeat'], config: {} },
      ],
      edges: [
        { from: 'source', to: 'repeat', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'repeat', to: 'lower', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    }));
    const result = await executeWorkflowsRun('lower.json', await createWorkflowProjectFixture(root));
    expect(result.success).toBe(false);
    expect(result.message).toContain('text-lower output exceeds its UTF-8 byte limit');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
