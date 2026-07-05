/**
 * DATA-002 P2 — code-node persistence: `.dag/nodes/<type>.node.json` (kind:'code') manifest +
 * supplementary `<type>.dag.node.js` companion. Real filesystem, no mocks.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  IDagDefinition,
  IDagNodeDefinition,
  INodeExecutionContext,
} from '@robota-sdk/dag-core';
import { loadNodes } from '../local-runner/persistence/store.js';
import { LocalDagRunner, createCliNodeRegistry } from '../local-runner/index.js';
import { runCommand } from '../commands/run.js';

function collectingIo(): { io: Parameters<typeof runCommand>[1]['io']; written: string[] } {
  const written: string[] = [];
  return {
    written,
    io: {
      write: (t: string) => written.push(t),
      writeError: (t: string) => written.push(t),
      readTextFile: async (path: string) => readFileSync(path, 'utf8'),
      writeBinaryStream: async () => {},
    },
  };
}

function makeExecContext(nodeType: string): INodeExecutionContext {
  return {
    dagId: 'd',
    dagRunId: 'r',
    taskRunId: 't',
    nodeDefinition: { nodeId: 'c1', nodeType, dependsOn: [], config: {} },
    nodeManifest: { nodeType, displayName: nodeType, category: 'Custom', inputs: [], outputs: [] },
    attempt: 0,
    executionPath: [],
    currentTotalCredits: 0,
  } as unknown as INodeExecutionContext;
}

function writeCodeNode(
  projectDir: string,
  nodeType: string,
  manifest: Record<string, unknown>,
  companion: string | null,
): void {
  const dir = join(projectDir, '.workflows', 'nodes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${nodeType}.node.json`),
    JSON.stringify({
      kind: 'code',
      nodeType,
      displayName: nodeType,
      inputs: [{ key: 'text', type: 'string', required: true }],
      outputs: [{ key: 'text', type: 'string', required: false }],
      defaultInputPort: 'text',
      defaultOutputPort: 'text',
      codeFile: `${nodeType}.dag.node.js`,
      ...manifest,
    }),
    'utf8',
  );
  if (companion !== null) {
    writeFileSync(join(dir, `${nodeType}.dag.node.js`), companion, 'utf8');
  }
}

const UPPER = `export const node = { execute: (i) => ({ text: String(i.text).toUpperCase() }) };\n`;

describe('DATA-002 P2 — code node persistence', () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'code-node-'));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('TC-01: loadNodes reconstructs a runnable code node (manifest metadata + companion execute)', async () => {
    writeCodeNode(projectDir, 'upshout', {}, UPPER);
    const defs: IDagNodeDefinition[] = [];
    await loadNodes(projectDir, defs);

    const node = defs.find((n) => n.nodeType === 'upshout');
    expect(node, 'code node must load').toBeDefined();
    expect(node!.displayName).toBe('upshout');
    expect(node!.defaultOutputPort).toBe('text');

    const result = await node!.taskHandler.execute({ text: 'hi' }, makeExecContext('upshout'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value['text']).toBe('HI');
  });

  it('TC-04: a manifest whose companion is missing is skipped without crashing', async () => {
    writeCodeNode(projectDir, 'good', {}, UPPER);
    writeCodeNode(projectDir, 'orphan', {}, null); // no companion .dag.node.js
    const defs: IDagNodeDefinition[] = [];
    await loadNodes(projectDir, defs);
    expect(defs.map((n) => n.nodeType)).toContain('good');
    expect(defs.map((n) => n.nodeType)).not.toContain('orphan');
  });

  it('TC-04: manifest nodeType wins over a differing companion export (metadata SSOT)', async () => {
    writeCodeNode(
      projectDir,
      'winner',
      {},
      `export const node = { nodeType: 'loser', execute: (i) => ({ text: i.text }) };\n`,
    );
    const defs: IDagNodeDefinition[] = [];
    await loadNodes(projectDir, defs);
    expect(defs.map((n) => n.nodeType)).toEqual(['winner']);
  });

  it('TC-05: a reloaded code node runs end-to-end through LocalDagRunner', async () => {
    writeCodeNode(projectDir, 'upshout', {}, UPPER);
    const loaded: IDagNodeDefinition[] = [];
    await loadNodes(projectDir, loaded);

    const dag: IDagDefinition = {
      dagId: 'code-run',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'in', nodeType: 'input', dependsOn: [], config: { text: 'hello' } },
        { nodeId: 'shout', nodeType: 'upshout', dependsOn: ['in'], config: {} },
      ],
      edges: [{ from: 'in', to: 'shout', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
    } as unknown as IDagDefinition;

    const runner = new LocalDagRunner([...createCliNodeRegistry(), ...loaded]);
    const result = await runner.run(dag, {});
    expect(result.dagRun.status).toBe('success');
    const shout = result.taskRuns.find((t) => t.nodeId === 'shout');
    expect(shout?.outputSnapshot).toBeDefined();
    expect(JSON.parse(shout!.outputSnapshot!)).toMatchObject({ text: 'HELLO' });
  });

  it('P3: a workflow under .workflows/ resolves a .workflows/nodes/ code node (projectDir walk-up)', async () => {
    writeCodeNode(projectDir, 'upshout', {}, UPPER);
    const wfDir = join(projectDir, '.workflows');
    mkdirSync(wfDir, { recursive: true });
    const dagFile = join(wfDir, 'shoutflow.json');
    writeFileSync(
      dagFile,
      JSON.stringify({
        dagId: 'shoutflow',
        version: 1,
        status: 'draft',
        nodes: [
          { nodeId: 'in', nodeType: 'input', dependsOn: [], config: { text: 'hi' } },
          { nodeId: 'shout', nodeType: 'upshout', dependsOn: ['in'], config: {} },
        ],
        edges: [{ from: 'in', to: 'shout', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
      }),
      'utf8',
    );

    const { io, written } = collectingIo();
    const exit = await runCommand([dagFile], { io });
    expect(exit).toBe(0);
    expect(written.join('')).toContain('HI');
  });
});
