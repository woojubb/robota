import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { executeWorkflowsRun } from '../run-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

const MAX_BYTES = 4 * 1024 * 1024;
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runRead(content: string | Buffer | undefined, limit = 1) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-read-budget-')));
  roots.push(root);
  vi.stubEnv('HOME', root);
  if (content !== undefined) writeFileSync(join(root, 'input.txt'), content);
  writeFileSync(join(root, 'read.json'), JSON.stringify({
    dagId: 'read-budget', version: 1, status: 'draft',
    nodes: [{
      nodeId: 'read', nodeType: 'tool', dependsOn: [],
      config: { toolName: 'read', params: { filePath: 'input.txt', limit } },
    }],
    edges: [],
  }));
  return executeWorkflowsRun('read.json', await createWorkflowProjectFixture(root));
}

it('/workflows read refuses oversized input even when only one line is requested', async () => {
  const result = await runRead(`small\n${'x'.repeat(MAX_BYTES)}`);
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/read input exceeds its UTF-8 byte limit/i);
});

it('/workflows read refuses formatted output amplification from one large line', async () => {
  const result = await runRead('x'.repeat(MAX_BYTES));
  expect(result.success).toBe(false);
  expect(result.message).toMatch(/read output exceeds its UTF-8 byte limit/i);
});

it('/workflows read preserves small-file line selection', async () => {
  const result = await runRead('alpha\nbeta\n');
  expect(result.success).toBe(true);
  expect(result.message).toContain('1\\talpha');
  expect(result.message).not.toContain('2\\tbeta');
});

it('/workflows read accepts the exact input boundary when the selected output is small', async () => {
  const result = await runRead(`alpha\n${'x'.repeat(MAX_BYTES - 6)}`);
  expect(result.success).toBe(true);
  expect(result.message).toContain('1\\talpha');
});

it('/workflows read keeps missing and binary files as soft tool results', async () => {
  const missing = await runRead(undefined);
  expect(missing.success).toBe(true);
  expect(missing.message).toContain('File not found:');

  const binary = Buffer.alloc(MAX_BYTES + 1);
  const binaryResult = await runRead(binary);
  expect(binaryResult.success).toBe(true);
  expect(binaryResult.message).toContain('Binary file not supported:');
});
