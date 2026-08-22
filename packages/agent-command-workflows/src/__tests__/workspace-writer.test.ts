import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
  type ICompositeSubRunner,
} from '@robota-sdk/dag-node-instant-node';
import type {
  IDagDefinition,
  IDagNodeDefinition,
  INodeExecutionContext,
} from '@robota-sdk/dag-core';
import { saveInstantNodeFile as saveInstantNodeFileWithProject } from '../persistence/workspace-writer.js';
import { loadInstantNodes as loadInstantNodesWithProject } from '../persistence/instant-node-loader.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

async function saveInstantNodeFile(
  root: string,
  node: IDagNodeDefinition,
  createdAt: string,
  layout?: Parameters<typeof saveInstantNodeFileWithProject>[3],
) {
  return saveInstantNodeFileWithProject(
    await createWorkflowProjectFixture(root),
    node,
    createdAt,
    layout,
  );
}

async function loadInstantNodes(
  root: string,
  layout?: Parameters<typeof loadInstantNodesWithProject>[1],
) {
  return loadInstantNodesWithProject(await createWorkflowProjectFixture(root), layout);
}

const AT = '2026-07-06T00:00:00.000Z';
const RUNNER: ICompositeSubRunner = { run: async () => ({ ok: true, outputs: {} }) };

/**
 * A pure inner DAG: a single `input` node emitting a fixed `text` from its config. No LLM/provider —
 * deterministic — so the reloaded composite can run end-to-end without credentials. Mirrors the
 * dag-cli `composite-reload-real` fixture on the agent `/workflows` persistence path.
 */
const INNER_DAG = {
  dagId: 'inner',
  version: 1,
  status: 'draft',
  nodes: [{ nodeId: 'echo', nodeType: 'input', dependsOn: [], config: { text: 'from-inner-dag' } }],
  edges: [],
} as unknown as IDagDefinition;

function makeExecContext(node: IDagNodeDefinition): INodeExecutionContext {
  return {
    dagId: 'd',
    dagRunId: 'r',
    taskRunId: 't',
    nodeDefinition: { nodeId: 'c1', nodeType: node.nodeType, dependsOn: [], config: {} },
    nodeManifest: {
      nodeType: node.nodeType,
      displayName: node.displayName,
      category: node.category,
      inputs: node.inputs,
      outputs: node.outputs,
    },
    attempt: 0,
    executionPath: [],
    currentTotalCredits: 0,
  } as unknown as INodeExecutionContext;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ws-writer-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('DATA-003 saveInstantNodeFile', () => {
  it('persists a prompt node and reloads it via the owner round-trip', async () => {
    const node = createPromptBackedNodeDefinition({
      nodeType: 'pirate',
      displayName: 'Pirate',
      systemPromptTemplate: 'Rewrite: {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' },
      provider: 'anthropic',
    });
    const path = await saveInstantNodeFile(dir, node, AT);
    expect(path).toContain('pirate.node.json');
    await expect(stat(join(dir, path as string))).resolves.toBeDefined();

    const reloaded = await loadInstantNodes(dir);
    expect(reloaded.map((n) => n.nodeType)).toContain('pirate');
  });

  it('WORKFLOW-005 P2: persists a composite node, then reloads AND runs it (no drop)', async () => {
    const composite = createCompositeInstantNodeDefinition({
      nodeType: 'echo-composite',
      displayName: 'Echo Composite',
      innerDag: INNER_DAG,
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'echo', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'echo', portKey: 'text' } }],
      runner: RUNNER,
    });

    // 1. Persist the composite (no longer refused) → a manifest is written.
    const path = await saveInstantNodeFile(dir, composite, AT);
    expect(path).toContain('echo-composite.node.json');
    await expect(stat(join(dir, path as string))).resolves.toBeDefined();

    // 2. Simulate restart: a fresh load reconstructs the composite (with an injected sub-runner).
    const reloaded = await loadInstantNodes(dir);
    const node = reloaded.find((n) => n.nodeType === 'echo-composite');
    expect(node, 'composite must survive reload (not be dropped)').toBeDefined();

    // 3. The reloaded composite RUNS its inner DAG for real and flows its exposed output out.
    const runResult = await node!.taskHandler.execute({ text: 'trigger' }, makeExecContext(node!));
    expect(runResult.ok).toBe(true);
    if (runResult.ok) {
      expect(runResult.value['result']).toBe('from-inner-dag');
    }
  });

  it('skips a non-instant (built-in) node', async () => {
    const notInstant = { nodeType: 'plain' } as unknown as Parameters<
      typeof saveInstantNodeFile
    >[1];
    const path = await saveInstantNodeFile(dir, notInstant, AT);
    expect(path).toBeNull();
  });
});
