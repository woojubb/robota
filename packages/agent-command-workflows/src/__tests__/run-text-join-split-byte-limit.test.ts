import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function run(nodeType: 'text-join' | 'text-split', source: string, config: Record<string, unknown>) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'workflow-text-join-split-cap-')));
  roots.push(root);
  vi.stubEnv('HOME', root);
  writeFileSync(path.join(root, 'workflow.json'), JSON.stringify({
    dagId: 'text-output-limit', version: 1, status: 'draft',
    nodes: [
      { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: source } },
      { nodeId: 'output', nodeType, dependsOn: ['source'], config },
    ],
    edges: [{ from: 'source', to: 'output', bindings: [{ outputKey: 'text', inputKey: nodeType === 'text-join' ? 'items' : 'text' }] }],
  }));
  return executeWorkflowsRun('workflow.json', await createWorkflowProjectFixture(root));
}

it('/workflows run rejects text-join separator amplification before joining', async () => {
  const result = await run('text-join', 'x\n'.repeat(4097), {
    separator: 'y'.repeat(1024), byteLimits: { maxTextJoinOutputBytes: Number.MAX_SAFE_INTEGER },
  });
  expect(result.success).toBe(false);
  expect(result.message).toContain('text-join output exceeds its UTF-8 byte limit');
});

it('/workflows run rejects text-split newline amplification before splitting', async () => {
  const result = await run('text-split', 'x'.repeat(2_097_153), {
    separator: '', trim: false, byteLimits: { maxTextSplitOutputBytes: Number.MAX_SAFE_INTEGER },
  });
  expect(result.success).toBe(false);
  expect(result.message).toContain('text-split output exceeds its UTF-8 byte limit');
});
