import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

it('/workflows run rejects regex replacement amplification at the built-in output ceiling', async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'workflow-regex-cap-')));
  vi.stubEnv('HOME', root);
  try {
    writeFileSync(path.join(root, 'regex.json'), JSON.stringify({
      dagId: 'regex-limit', version: 1, status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x'.repeat(2000) } },
        { nodeId: 'replace', nodeType: 'text-replace', dependsOn: ['source'], config: {
          useRegex: true, search: 'x', flags: 'g', replacement: 'y'.repeat(3000),
          byteLimits: { maxTextReplaceOutputBytes: Number.MAX_SAFE_INTEGER },
        } },
      ],
      edges: [{ from: 'source', to: 'replace', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
    }));
    const result = await executeWorkflowsRun('regex.json', await createWorkflowProjectFixture(root));
    expect(result.success).toBe(false);
    expect(result.message).toContain('Regex operation output exceeds its byte limit');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
