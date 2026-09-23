/**
 * DATA-002 persistence store — real-fs round-trips (no mocks).
 * Phase 1: workflows and data-node manifests are owned by the single store.
 */
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  IDagDefinition,
  IDagExecutionLineage,
  IDagNodeDefinition,
  INodeExecutionContext,
  IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import { buildTaskExecutionError } from '@robota-sdk/dag-core';
import { createCompositeInstantNodeDefinition } from '@robota-sdk/dag-node-instant-node';
import {
  buildCompositeRunner,
  saveNode,
  loadNodes,
  saveWorkflow,
  loadWorkflows,
} from '../local-runner/persistence/store.js';
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
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'persist-store-')));
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

describe('BEHAVIOR-006 composite node reload through the local CLI store', () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'composite-reload-')));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('saves, reloads, and runs a composite with a restored sub-runner', async () => {
    const innerDag: IDagDefinition = {
      dagId: 'inner',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'echo', nodeType: 'input', dependsOn: [], config: { text: 'from-inner-dag' } },
      ],
      edges: [],
    } as unknown as IDagDefinition;
    const original = createCompositeInstantNodeDefinition({
      nodeType: 'echo-composite',
      displayName: 'Echo Composite',
      innerDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'echo', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'echo', portKey: 'text' } }],
      runner: {
        run: async () => {
          throw new Error('creation-time runner must not be reused');
        },
      },
    });

    await saveNode(original, projectDir);
    const reloaded: IDagNodeDefinition[] = [];
    await loadNodes(projectDir, reloaded);
    const node = reloaded.find((definition) => definition.nodeType === 'echo-composite');
    expect(node).toBeDefined();

    const context: INodeExecutionContext = {
      executionRoot: projectDir,
      dagId: 'outer',
      dagRunId: 'run',
      taskRunId: 'task',
      nodeDefinition: { nodeId: 'composite', nodeType: node!.nodeType, dependsOn: [], config: {} },
      nodeManifest: {
        nodeType: node!.nodeType,
        displayName: node!.displayName,
        category: node!.category,
        inputs: node!.inputs,
        outputs: node!.outputs,
      },
      attempt: 0,
      executionPath: [],
      currentTotalCredits: 0,
    };
    const result = await node!.taskHandler.execute({ text: 'trigger' }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value['result']).toBe('from-inner-dag');
  });

  it('forwards the root and parent lineage into a real nested local run', async () => {
    const lineage: IDagExecutionLineage = {
      rootRunId: 'root-run',
      parentRunId: 'parent-run',
      depth: 1,
      ancestorCompositeNodeTypes: ['outer'],
    };
    const observed: IDagExecutionLineage[] = [];
    const probe: IDagNodeDefinition = {
      nodeType: 'lineage-probe',
      displayName: 'Lineage Probe',
      category: 'test',
      inputs: [],
      outputs: [],
      configSchemaDefinition: null,
      taskHandler: {
        execute: async (_input, context) => {
          if (context.lineage) observed.push(context.lineage);
          return { ok: true, value: {} };
        },
      },
    };
    const dag: IDagDefinition = {
      dagId: 'lineage-child',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'probe', nodeType: 'lineage-probe', dependsOn: [], config: {} }],
      edges: [],
    };
    const result = await buildCompositeRunner([probe], projectDir).run(dag, {}, lineage);
    expect(result.ok).toBe(true);
    expect(observed).toEqual([lineage]);
  });

  it('preserves an ancestor depth failure and its non-retryable code across a real child run', async () => {
    const inputDag: IDagDefinition = {
      dagId: 'inner-input',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'input', nodeType: 'input', dependsOn: [], config: { text: 'x' } }],
      edges: [],
    };
    const child = createCompositeInstantNodeDefinition({
      nodeType: 'child',
      displayName: 'Child',
      innerDag: inputDag,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'input', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'input', portKey: 'text' } }],
      runner: {
        run: async () => {
          throw new Error('creation-time runner');
        },
      },
    });
    const childDag: IDagDefinition = {
      dagId: 'inner-child',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'source', nodeType: 'input', dependsOn: [], config: { text: 'x' } },
        { nodeId: 'child-node', nodeType: 'child', dependsOn: ['source'], config: {} },
      ],
      edges: [
        { from: 'source', to: 'child-node', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    };
    const outer = createCompositeInstantNodeDefinition({
      nodeType: 'outer',
      displayName: 'Outer',
      innerDag: childDag,
      maxDepth: 1,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'source', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'child-node', portKey: 'result' } }],
      runner: {
        run: async () => {
          throw new Error('creation-time runner');
        },
      },
    });
    await saveNode(child, projectDir);
    await saveNode(outer, projectDir);
    const reloaded: IDagNodeDefinition[] = [];
    await loadNodes(projectDir, reloaded);
    const node = reloaded.find((definition) => definition.nodeType === 'outer');
    expect(node).toBeDefined();
    const result = await node!.taskHandler.execute(
      { text: 'x' },
      {
        executionRoot: projectDir,
        dagId: 'root',
        dagRunId: 'root-run',
        taskRunId: 'root-task',
        nodeDefinition: { nodeId: 'outer-node', nodeType: 'outer', dependsOn: [], config: {} },
        nodeManifest: {
          nodeType: node!.nodeType,
          displayName: node!.displayName,
          category: node!.category,
          inputs: node!.inputs,
          outputs: node!.outputs,
        },
        attempt: 0,
        executionPath: [],
        currentTotalCredits: 0,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'DAG_TASK_EXECUTION_COMPOSITE_DEPTH_EXCEEDED', retryable: false },
    });
  });

  it('preserves a retryable terminal task error from a real child run', async () => {
    const failingNode: IDagNodeDefinition = {
      nodeType: 'transient',
      displayName: 'Transient',
      category: 'test',
      inputs: [],
      outputs: [],
      configSchemaDefinition: null,
      taskHandler: {
        execute: async () => ({
          ok: false,
          error: buildTaskExecutionError('DAG_TASK_EXECUTION_TRANSIENT', 'try again', true),
        }),
      },
    };
    const result = await buildCompositeRunner([failingNode], projectDir).run(
      {
        dagId: 'transient-child',
        version: 1,
        status: 'draft',
        nodes: [{ nodeId: 'transient', nodeType: 'transient', dependsOn: [], config: {} }],
        edges: [],
      },
      {},
      {
        rootRunId: 'root-run',
        parentRunId: 'parent-run',
        depth: 1,
        ancestorCompositeNodeTypes: ['outer'],
      },
    );
    expect(result).toMatchObject({
      ok: false,
      errorCode: 'DAG_TASK_EXECUTION_TRANSIENT',
      retryable: true,
    });
  });
});
