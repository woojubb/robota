/**
 * DATA-002 persistence store — real-fs round-trips (no mocks).
 * Phase 1: workflows and data-node manifests are owned by the single store.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
  saveWorkflow,
  loadWorkflows,
  workflowsDir,
  WORKFLOW_EXT,
} from '../local-runner/persistence/store.js';

const WORKFLOW: IDagDefinition = {
  dagId: 'my-flow',
  version: 1,
  status: 'draft',
  nodes: [{ nodeId: 'n1', nodeType: 'input', dependsOn: [], config: { text: 'hi' } }],
  edges: [],
} as unknown as IDagDefinition;

describe('DATA-002 persistence store — workflows (TC-03)', () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'persist-store-'));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('round-trips a workflow: saveWorkflow → loadWorkflows → identical definition', async () => {
    const written = await saveWorkflow('my-flow', WORKFLOW, projectDir);
    expect(written).toBe(join(workflowsDir(projectDir), `my-flow${WORKFLOW_EXT}`));

    const loaded = await loadWorkflows(projectDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('my-flow');
    expect(loaded[0].definition).toEqual(WORKFLOW);
  });

  it('returns empty when .dag/workflows/ does not exist', async () => {
    const loaded = await loadWorkflows(projectDir);
    expect(loaded).toEqual([]);
  });

  it('skips non-.dag.json and malformed files', async () => {
    await saveWorkflow('good', WORKFLOW, projectDir);
    const fs = await import('node:fs/promises');
    await fs.writeFile(join(workflowsDir(projectDir), 'notes.txt'), 'ignore me', 'utf-8');
    await fs.writeFile(join(workflowsDir(projectDir), 'broken.dag.json'), '{ not json', 'utf-8');

    const loaded = await loadWorkflows(projectDir);
    expect(loaded.map((w) => w.name)).toEqual(['good']);
  });
});
