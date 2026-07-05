/**
 * DATA-002 persistence store — real-fs round-trips (no mocks).
 * Phase 1: workflows and data-node manifests are owned by the single store.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDagDefinition, IWorkspaceLayout } from '@robota-sdk/dag-core';
import { saveWorkflow, loadWorkflows } from '../local-runner/persistence/store.js';
import { workflowsDir, WORKFLOW_EXT } from '../local-runner/persistence/paths.js';

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

  it('workflows live flat in the default .workflows/ root as <name>.json', async () => {
    const written = await saveWorkflow('my-flow', WORKFLOW, projectDir);
    expect(written).toBe(join(projectDir, '.workflows', 'my-flow.json'));
  });

  it('returns empty when the workspace root does not exist', async () => {
    const loaded = await loadWorkflows(projectDir);
    expect(loaded).toEqual([]);
  });

  it('skips non-workflow, malformed, and non-DAG JSON sharing the root', async () => {
    await saveWorkflow('good', WORKFLOW, projectDir);
    const fs = await import('node:fs/promises');
    await fs.writeFile(join(workflowsDir(projectDir), 'notes.txt'), 'ignore me', 'utf-8');
    await fs.writeFile(join(workflowsDir(projectDir), 'broken.json'), '{ not json', 'utf-8');
    // aux JSON that shares the root (e.g. aliases) parses fine but is not a DAG → skipped.
    await fs.writeFile(join(workflowsDir(projectDir), 'aliases.json'), '{"a":1}', 'utf-8');

    const loaded = await loadWorkflows(projectDir);
    expect(loaded.map((w) => w.name)).toEqual(['good']);
  });

  it('TC-01: a custom injected layout redirects reads/writes to that root + extension', async () => {
    const layout: IWorkspaceLayout = { root: '.custom-ws', workflowExt: '.flow.json' };
    const written = await saveWorkflow('my-flow', WORKFLOW, projectDir, layout);
    expect(written).toBe(join(projectDir, '.custom-ws', 'my-flow.flow.json'));

    // default layout does NOT see it; the injected layout does.
    expect(await loadWorkflows(projectDir)).toEqual([]);
    const loaded = await loadWorkflows(projectDir, layout);
    expect(loaded.map((w) => w.name)).toEqual(['my-flow']);
    expect(loaded[0].definition).toEqual(WORKFLOW);
  });
});
