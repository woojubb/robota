/**
 * SEC-007 — `file-write` is the more serious half of the pair: a `.dag.json` is a shareable,
 * LLM-authorable document, and its `path` reached `writeFile`/`appendFile` with no containment check
 * at all. With `createDirs: true` (the DEFAULT) the node also `mkdir -p`s the parent first, so a
 * workflow could create and populate a file anywhere the process can reach — `~/.bashrc`,
 * `~/.ssh/authorized_keys`, a shell profile — turning "run this workflow" into code execution on the
 * next login.
 *
 * The containment root is the directory the run was invoked from: the node already anchored relative
 * paths there, so this makes explicit the boundary it was implicitly claiming.
 *
 * Real filesystem, real symlinks. The pre-existing suite mocks `node:fs/promises`, and a mocked
 * filesystem cannot have a symlink in it.
 */

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { FileWriteNodeDefinition } from '../index.js';

import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

let root: string;
let workdir: string;
let outside: string;
let originalCwd: string;

function makeContext(config: Record<string, unknown> = {}): INodeExecutionContext {
  return {
    executionRoot: workdir,
    nodeDefinition: { nodeId: 'n1', nodeType: 'file-write', config, inputs: [], outputs: [] },
    dagRunId: 'run-1',
    dagId: 'dag-1',
  } as unknown as INodeExecutionContext; // allow-any: minimal test stub
}

beforeAll(() => {
  originalCwd = process.cwd();
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sec007-dag-write-')));
  workdir = join(root, 'workdir');
  outside = join(root, 'outside');
  mkdirSync(workdir, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'profile'), 'original\n');
  symlinkSync(outside, join(workdir, 'escape'));
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

describe('file-write — confined to the invocation directory (SEC-007)', () => {
  it('uses context.executionRoot rather than the ambient process cwd', async () => {
    process.chdir(outside);
    const target = join(workdir, 'ambient-independent.txt');
    expect(await write(target, 'inside-root')).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('inside-root');
  });

  const node = new FileWriteNodeDefinition();

  async function write(path: string, text: string, append = false): Promise<boolean> {
    const input: TPortPayload = { path, text };
    const result = await node.taskHandler.execute(
      input,
      makeContext({ path: '', encoding: 'utf8', append, createDirs: true }),
    );
    return result.ok;
  }

  it('refuses an ABSOLUTE path outside the invocation directory', async () => {
    const target = join(outside, 'planted.sh');
    expect(await write(target, 'payload')).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it('refuses a `..` traversal, and creates no directory on the way', async () => {
    expect(await write('../outside/nested/planted.sh', 'payload')).toBe(false);
    expect(existsSync(join(outside, 'nested'))).toBe(false);
  });

  it('refuses to write through an escaping SYMLINKED DIRECTORY', async () => {
    expect(await write('escape/planted.sh', 'payload')).toBe(false);
    expect(existsSync(join(outside, 'planted.sh'))).toBe(false);
  });

  it('refuses to APPEND to an existing file outside the root', async () => {
    expect(await write('escape/profile', 'malicious\n', true)).toBe(false);
    expect(readFileSync(join(outside, 'profile'), 'utf8')).toBe('original\n');
  });

  it('still writes an ordinary file inside the invocation directory', async () => {
    expect(await write('out/result.txt', 'fine')).toBe(true);
    expect(readFileSync(join(workdir, 'out', 'result.txt'), 'utf8')).toBe('fine');
  });
});
