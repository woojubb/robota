/**
 * SEC-007 — a `.dag.json` is a shareable, LLM-authorable document, and `file-read` took its `path`
 * straight out of it with no containment check at all.
 *
 * That is a different (and larger) problem than the LEXICAL check SEC-006 fixed in the agent file
 * tools: there was nothing to make canonical. `resolve(process.cwd(), inputPath)` accepts an absolute
 * path outright, so a workflow that a user downloads, or that an agent authors, could read
 * `~/.ssh/id_rsa` or `/etc/passwd` on the machine that runs it.
 *
 * The containment root is the directory the run was invoked from. `INodeExecutionContext` carries no
 * workspace root, and the node already anchored relative paths to `process.cwd()` — so this makes the
 * boundary the one the node was already implicitly claiming, rather than inventing a new concept.
 *
 * Unlike the pre-existing suite for this node, these tests use the REAL filesystem: a test that mocks
 * `node:fs/promises` cannot observe a symlink, and so cannot observe this class of bug.
 */

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { FileReadNodeDefinition } from '../index.js';

import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

const CANARY = ['SEC007', 'DAG', 'OUT', 'OF', 'ROOT', Date.now().toString(36)].join('-');

let root: string;
let workdir: string;
let outside: string;
let originalCwd: string;

function makeContext(config: Record<string, unknown> = {}): INodeExecutionContext {
  return {
    nodeDefinition: { nodeId: 'n1', nodeType: 'file-read', config, inputs: [], outputs: [] },
    dagRunId: 'run-1',
    dagId: 'dag-1',
  } as unknown as INodeExecutionContext; // allow-any: minimal test stub
}

beforeAll(() => {
  originalCwd = process.cwd();
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sec007-dag-read-')));
  workdir = join(root, 'workdir');
  outside = join(root, 'outside');
  mkdirSync(workdir, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(workdir, 'inside.txt'), 'in-workflow content\n');
  writeFileSync(join(outside, 'secret.txt'), `${CANARY}\n`);
  symlinkSync(outside, join(workdir, 'escape'));
  symlinkSync(join(outside, 'secret.txt'), join(workdir, 'secret-link.txt'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(originalCwd);
});

describe('file-read — confined to the invocation directory (SEC-007)', () => {
  const node = new FileReadNodeDefinition();

  async function read(path: string): Promise<{ ok: boolean; text?: unknown; code?: string }> {
    const input: TPortPayload = { path };
    const result = await node.taskHandler.execute(
      input,
      makeContext({ path: '', encoding: 'utf8' }),
    );
    return result.ok
      ? { ok: true, text: result.value['text'] }
      : { ok: false, code: result.error.code };
  }

  it('refuses an ABSOLUTE path outside the invocation directory', async () => {
    const result = await read(join(outside, 'secret.txt'));
    expect(result.ok).toBe(false);
    expect(String(result.text ?? '')).not.toContain(CANARY);
  });

  it('refuses a `..` traversal out of the invocation directory', async () => {
    const result = await read('../outside/secret.txt');
    expect(result.ok).toBe(false);
  });

  it('refuses a path reached through an escaping SYMLINKED DIRECTORY', async () => {
    const result = await read('escape/secret.txt');
    expect(result.ok).toBe(false);
    expect(String(result.text ?? '')).not.toContain(CANARY);
  });

  it('refuses a SYMLINKED FILE inside the root whose target is outside', async () => {
    const result = await read('secret-link.txt');
    expect(result.ok).toBe(false);
    expect(String(result.text ?? '')).not.toContain(CANARY);
  });

  it('still reads an ordinary file inside the invocation directory', async () => {
    const result = await read('inside.txt');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('in-workflow content\n');
  });
});
