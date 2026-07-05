import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeCommand, type INodeCommandOptions } from '../commands/node.js';
import { loadLocalNodeDefinitions, loadNodeFileExplicit } from '../local-runner/index.js';

// ---------------------------------------------------------------------------
// IO helper — matches the pattern used in node-command.test.ts
// ---------------------------------------------------------------------------

function makeIo(): { options: INodeCommandOptions; written: string[] } {
  const written: string[] = [];
  const options: INodeCommandOptions = {
    io: {
      write: (text: string) => {
        written.push(text);
      },
      writeError: (text: string) => {
        written.push(text);
      },
      readTextFile: async () => {
        throw new Error('not used in localnode-e2e tests');
      },
      writeBinaryStream: async () => {},
    },
  };
  return { options, written };
}

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'localnode-e2e-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// LOCALNODE-005: dag node scaffold --local
// ---------------------------------------------------------------------------

describe('LOCALNODE-005: dag node scaffold --local', () => {
  it('creates a .dag.node.js file with plain class template', async () => {
    const { options, written } = makeIo();
    const exitCode = await nodeCommand(
      [
        'scaffold',
        'my-transform',
        '--local',
        '--dir',
        tmpDir,
        '--input',
        'text:string',
        '--output',
        'result:string',
      ],
      options,
    );

    const output = written.join('');
    expect(exitCode).toBe(0);
    expect(output).toContain('Created');
    expect(output).toContain('my-transform.dag.node.js');

    const filePath = join(tmpDir, 'my-transform.dag.node.js');
    const content = await readFile(filePath, 'utf8');
    expect(content).toContain("nodeType: 'my-transform'"); // NODEDX-004: object format, not class property
    expect(content).not.toContain('defineDagNode');
    expect(content).not.toContain('import {');
    expect(content).toContain("key: 'text'");
    expect(content).toContain("key: 'result'");
  });

  it('rejects if the file already exists', async () => {
    const filePath = join(tmpDir, 'existing.dag.node.js');
    await writeFile(filePath, '// existing', 'utf8');

    const { options, written } = makeIo();
    const exitCode = await nodeCommand(
      ['scaffold', 'existing', '--local', '--dir', tmpDir],
      options,
    );

    expect(exitCode).toBe(2);
    expect(written.join('')).toContain('already exists');
  });

  it('generates config access via context when --config is given', async () => {
    const { options } = makeIo();
    const exitCode = await nodeCommand(
      ['scaffold', 'cfg-node', '--local', '--dir', tmpDir, '--config', 'lang:string'],
      options,
    );
    expect(exitCode).toBe(0);

    const content = await readFile(join(tmpDir, 'cfg-node.dag.node.js'), 'utf8');
    expect(content).not.toContain('z.object');
    expect(content).toContain('context?.nodeDefinition?.config');
    expect(content).toContain('lang');
  });

  it('uses default ports when none are specified', async () => {
    const { options } = makeIo();
    await nodeCommand(['scaffold', 'simple-node', '--local', '--dir', tmpDir], options);

    const content = await readFile(join(tmpDir, 'simple-node.dag.node.js'), 'utf8');
    // NODEDX-006: default output port is now 'text' (unified with built-in node convention)
    expect(content).toContain("key: 'text'");
  });
});

// ---------------------------------------------------------------------------
// LOCALNODE-002 / DATA-002 P2: loadLocalNodeDefinitions discovers `.dag/nodes/` code manifests
// ---------------------------------------------------------------------------

async function writeCodeNode(
  dir: string,
  nodeType: string,
  manifestExtra: Record<string, unknown>,
  companion: string | null,
): Promise<void> {
  const nodesDir = join(dir, '.dag', 'nodes');
  await mkdir(nodesDir, { recursive: true });
  await writeFile(
    join(nodesDir, `${nodeType}.node.json`),
    JSON.stringify({
      kind: 'code',
      nodeType,
      displayName: nodeType,
      inputs: [{ key: 'text', type: 'string', required: true }],
      outputs: [{ key: 'text', type: 'string', required: false }],
      codeFile: `${nodeType}.dag.node.js`,
      ...manifestExtra,
    }),
    'utf8',
  );
  if (companion !== null) {
    await writeFile(join(nodesDir, `${nodeType}.dag.node.js`), companion, 'utf8');
  }
}

describe('LOCALNODE-002 / DATA-002 P2: loadLocalNodeDefinitions from .dag/nodes/', () => {
  it('returns empty array when .dag/nodes/ is absent', async () => {
    const nodes = await loadLocalNodeDefinitions({ projectDir: tmpDir });
    expect(nodes).toHaveLength(0);
  });

  it('discovers a code node (manifest + companion) in .dag/nodes/', async () => {
    await writeCodeNode(
      tmpDir,
      'upshout',
      {},
      `export const node = { execute: (i) => ({ text: String(i.text).toUpperCase() }) };\n`,
    );
    const nodes = await loadLocalNodeDefinitions({ projectDir: tmpDir });
    expect(nodes.map((n) => n.nodeType)).toEqual(['upshout']);
  });

  it('skips a code manifest whose companion .dag.node.js is missing', async () => {
    await writeCodeNode(tmpDir, 'orphan', {}, null);
    const nodes = await loadLocalNodeDefinitions({ projectDir: tmpDir });
    expect(nodes).toHaveLength(0);
  });

  it('does NOT scatter-scan .dag.node.js elsewhere in the project (removed in P2)', async () => {
    await writeFile(
      join(tmpDir, 'stray.dag.node.js'),
      `export const node = { nodeType: 'stray', execute: () => ({ text: 'x' }) };\n`,
      'utf8',
    );
    const nodes = await loadLocalNodeDefinitions({ projectDir: tmpDir });
    expect(nodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// LOCALNODE-003: loadNodeFileExplicit — error handling
// ---------------------------------------------------------------------------

describe('LOCALNODE-003: loadNodeFileExplicit error handling', () => {
  it('throws when the file does not exist', async () => {
    await expect(loadNodeFileExplicit(join(tmpDir, 'missing.dag.node.js'))).rejects.toThrow(
      'not found',
    );
  });

  it('throws with tsx hint when given a .ts file', async () => {
    const tsPath = join(tmpDir, 'node.dag.node.ts');
    await writeFile(tsPath, '// ts', 'utf8');
    await expect(loadNodeFileExplicit(tsPath)).rejects.toThrow('tsx');
  });

  it('throws when the default export is not a constructor', async () => {
    const jsPath = join(tmpDir, 'bad.dag.node.js');
    await writeFile(jsPath, `export default 42;\n`, 'utf8');
    await expect(loadNodeFileExplicit(jsPath)).rejects.toThrow('constructor');
  });

  it('throws when the instance has no nodeType property', async () => {
    const jsPath = join(tmpDir, 'no-type.dag.node.js');
    await writeFile(jsPath, `export default class N { displayName = 'test'; }\n`, 'utf8');
    await expect(loadNodeFileExplicit(jsPath)).rejects.toThrow('nodeType');
  });
});
