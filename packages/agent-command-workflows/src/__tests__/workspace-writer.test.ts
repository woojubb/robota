import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
  type ICompositeSubRunner,
} from '@robota-sdk/dag-node-instant-node';
import { saveInstantNodeFile } from '../persistence/workspace-writer.js';
import { loadInstantNodes } from '../persistence/instant-node-loader.js';

const AT = '2026-07-06T00:00:00.000Z';
const RUNNER: ICompositeSubRunner = { run: async () => ({ ok: true, outputs: {} }) };

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
    await expect(stat(path as string)).resolves.toBeDefined();

    const reloaded = await loadInstantNodes(dir);
    expect(reloaded.map((n) => n.nodeType)).toContain('pirate');
  });

  it('TC-03: refuses to write a composite node (no unreloadable orphan)', async () => {
    const composite = createCompositeInstantNodeDefinition({
      nodeType: 'wrap',
      displayName: 'Wrap',
      innerDag: { dagId: 'inner', version: 1, status: 'draft', nodes: [], edges: [] },
      exposedInputPort: { key: 'text', mapsTo: { nodeId: 'a', portKey: 'text' } },
      exposedOutputPorts: [{ key: 'out', mapsTo: { nodeId: 'b', portKey: 'text' } }],
      runner: RUNNER,
    });
    const path = await saveInstantNodeFile(dir, composite, AT);
    expect(path).toBeNull();
    // nothing was written → no orphan for the loader to silently drop.
    await expect(readdir(join(dir, '.workflows', 'nodes'))).rejects.toBeDefined();
  });

  it('skips a non-instant (built-in) node', async () => {
    const notInstant = { nodeType: 'plain' } as unknown as Parameters<
      typeof saveInstantNodeFile
    >[1];
    const path = await saveInstantNodeFile(dir, notInstant, AT);
    expect(path).toBeNull();
  });
});
