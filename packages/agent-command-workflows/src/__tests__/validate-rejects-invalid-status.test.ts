import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeWorkflowsValidate as executeWorkflowsValidateWithProject } from '../validate-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

async function executeWorkflowsValidate(file: string, root: string) {
  return executeWorkflowsValidateWithProject(file, await createWorkflowProjectFixture(root));
}

/**
 * DAG-002, review round 2.
 *
 * `/workflows validate` open-coded the format branch and assigned a legacy-format object straight
 * through as `IDagDefinition` with no check, so a file carrying `status: 'active'` — the value
 * DAG-002 exists to eliminate, and one `dag-cli node`'s example generator emitted until this same
 * change fixed it — was reported as valid by the surface whose entire job is answering that question.
 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspaceWith(contents: unknown): { cwd: string; file: string } {
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'validate-status-')));
  dirs.push(cwd);
  writeFileSync(path.join(cwd, 'w.json'), JSON.stringify(contents));
  return { cwd, file: 'w.json' };
}

describe('/workflows validate reports a status the domain type cannot hold (DAG-002)', () => {
  it('rejects a definition whose status is outside the union', async () => {
    const { cwd, file } = workspaceWith({
      dagId: 'd',
      version: 1,
      status: 'active',
      nodes: [],
      edges: [],
    });

    const result = await executeWorkflowsValidate(file, cwd);

    // The message, not just the verdict. MEASURED against the unfixed code: it already returned
    // `success: false` — for an unrelated "1 issue" about the empty node list — so asserting the
    // verdict alone is an accidental green that passes whether or not the status is ever checked.
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/'active'/);
  });

  it('still reports a shape that is neither format', async () => {
    const { cwd, file } = workspaceWith({ something: 'else' });
    const result = await executeWorkflowsValidate(file, cwd);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Not a DAG file/);
  });
});
