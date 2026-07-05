/**
 * BEHAVIOR-006 live integration: a composite instant node survives a real save → reload round-trip
 * on the actual filesystem and RUNS after "restart" — no fs/runner mocks. Uses a pure inner DAG
 * (an `input` node) so no provider credentials are needed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  IDagDefinition,
  IDagNodeDefinition,
  INodeExecutionContext,
} from '@robota-sdk/dag-core';
import {
  handleDagInstantNodeCreateComposite,
  loadSavedInstantNodes,
} from '../mcp/handlers/instant-nodes.js';
import type { ILocalMcpServerContext } from '../mcp/context.js';

// A pure inner DAG: a single `input` node that emits a fixed `text`. No LLM, deterministic.
const INNER_DAG: IDagDefinition = {
  dagId: 'inner',
  version: 1,
  status: 'draft',
  nodes: [{ nodeId: 'echo', nodeType: 'input', dependsOn: [], config: { text: 'from-inner-dag' } }],
  edges: [],
} as unknown as IDagDefinition;

function makeRealContext(projectDir: string): ILocalMcpServerContext {
  const instantNodeDefinitions: IDagNodeDefinition[] = [];
  return {
    getAllDefinitions: () => instantNodeDefinitions as never,
    getManifests: () => [],
    invalidateNodeCache: () => undefined,
    addCompletedRun: () => undefined,
    getCompletedRun: () => undefined,
    listCompletedRuns: () => [],
    getActiveProvider: () => ({ providerId: 'local' }),
    setActiveProvider: () => undefined,
    instantNodeDefinitions,
    options: { projectDir } as ILocalMcpServerContext['options'],
  };
}

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
  };
}

describe('BEHAVIOR-006 composite reload — real fs + runner', () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'composite-reload-'));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates → persists → reloads → runs a composite after a simulated restart', async () => {
    // 1. Create + persist the composite (writes .dag/nodes/echo-composite.node.json).
    const createCtx = makeRealContext(projectDir);
    const created = await handleDagInstantNodeCreateComposite(
      createCtx,
      {
        nodeType: 'echo-composite',
        displayName: 'Echo Composite',
        innerDag: INNER_DAG,
        exposedInputPort: { key: 'text', mapsTo: { nodeId: 'echo', portKey: 'text' } },
        exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'echo', portKey: 'text' } }],
      },
      undefined,
    );
    expect(created.isError).toBeFalsy();
    expect(createCtx.instantNodeDefinitions.map((n) => n.nodeType)).toContain('echo-composite');

    // 2. Simulate restart: a FRESH registry reloads from disk.
    const reloaded: IDagNodeDefinition[] = [];
    await loadSavedInstantNodes(projectDir, reloaded);
    const node = reloaded.find((n) => n.nodeType === 'echo-composite');
    expect(node, 'composite must survive reload (not be dropped)').toBeDefined();

    // 3. Run the reloaded composite for real (inner DAG runs through LocalDagRunner).
    const runResult = await node!.taskHandler.execute({ text: 'trigger' }, makeExecContext(node!));
    expect(runResult.ok).toBe(true);
    if (runResult.ok) {
      // The reloaded composite's inner DAG actually executed and its exposed output flowed through.
      expect(runResult.value['result']).toBe('from-inner-dag');
    }
  });
});
