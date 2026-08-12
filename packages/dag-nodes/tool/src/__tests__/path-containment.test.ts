/**
 * SEC-007 part A, the registration site the assembly sweep did not reach.
 *
 * Part A contained `Glob`/`Grep` by making the two ASSEMBLIES build their own instances
 * (`createDefaultTools`, `createCodingPack`) instead of importing the module-level singletons. This
 * node is the THIRD registration site, and it kept handing back `globTool`/`grepTool` — the very
 * objects whose doc comment says "UNCONTAINED, deliberately". It is registered in
 * `dag-nodes-default`, so `{"nodeType":"tool","config":{"toolName":"grep"}}` in any `.dag.json`
 * reached them.
 *
 * The threat model is the one part A already accepted for `file-read`/`file-write` in this same
 * package family: a `.dag.json` is a shareable, LLM-authorable document. The `tool` node was strictly
 * worse than the `file-*` nodes it sits beside — `toolName: "read"` with an absolute path bypassed
 * `file-read`'s containment entirely, because `config.cwd` is optional and `checkPathWithinCwd` WAS a
 * NO-OP when `cwd` was `undefined` (ARCH-010 has since made that case refuse, and made the root a
 * required constructor argument). The guard was disarmed by omission, which is exactly what
 * `pack-coding` made `cwd` REQUIRED to prevent.
 *
 * And `config.cwd` could not have been the boundary even when set: it comes out of the same
 * LLM-authorable document as the path it is supposed to contain, so `{"cwd":"/"}` disarms it. A root
 * the attacker supplies is not a root. It may therefore only NARROW the invocation directory.
 *
 * Real filesystem, real symlinks — the pre-existing `tool-node.test.ts` reads out of `tmpdir()`,
 * which only passed because nothing was contained.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGlobTool, createGrepTool } from '@robota-sdk/agent-tools';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { ToolNodeDefinition } from '../index.js';

import type { INodeExecutionContext, TPortPayload } from '@robota-sdk/dag-core';

let root: string;
let workdir: string;
let outside: string;
let originalCwd: string;

function makeContext(config: Record<string, unknown>): INodeExecutionContext {
  return {
    executionRoot: workdir,
    nodeDefinition: { nodeId: 'n1', nodeType: 'tool', config, inputs: [], outputs: [] },
    dagRunId: 'run-1',
    dagId: 'dag-1',
  } as unknown as INodeExecutionContext; // allow-any: minimal test stub
}

beforeAll(() => {
  originalCwd = process.cwd();
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sec007-dag-tool-')));
  workdir = join(root, 'workdir');
  outside = join(root, 'outside');
  mkdirSync(join(workdir, 'sub'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'outside.txt'), 'SECRET-VALUE\n');
  writeFileSync(join(workdir, 'inside.txt'), 'ordinary\n');
  writeFileSync(join(workdir, 'sub', 'nested.txt'), 'nested-ordinary\n');
  // The escape: an ordinary symlink, sitting inside the root, pointing out of it. `escape` is a
  // perfectly plain path segment — no amount of segment validation would catch it.
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

const node = new ToolNodeDefinition();

async function run(
  config: Record<string, unknown>,
  input: TPortPayload = {},
): Promise<{ ok: boolean; output: string; isError: boolean; code: string }> {
  const result = await node.taskHandler.execute(input, makeContext(config));
  if (!result.ok) return { ok: false, output: '', isError: true, code: result.error.code };
  return {
    ok: true,
    output: String(result.value['output'] ?? ''),
    isError: result.value['isError'] === true,
    code: '',
  };
}

/**
 * ARCH-010 INVERTED this block. It was a CONTROL asserting the opposite of what it now asserts: that
 * the module-level `globTool`/`grepTool` this node used to hand out really did escape, because a guard
 * with no root answered "allowed" and a singleton can never have a root. Those singletons are deleted
 * and the root is a required constructor argument, so the escape is no longer constructible and the
 * control has nothing left to demonstrate. What replaces it is the same demonstration from the other
 * side: the SAME two tools, built the way this node builds them, do not reach through the symlink.
 */
describe('CONTROL — the tools this node hands out are rooted, and do not escape (ARCH-010)', () => {
  it('Glob does not enumerate out-of-root files through the escaping symlink', async () => {
    const glob = createGlobTool({ cwd: workdir });
    const raw = await glob.execute({ pattern: '**/*.txt' } as Parameters<typeof glob.execute>[0]);
    // The in-root hit first: an absence assertion that holds because nothing ran at all would prove
    // nothing, and that is the shape an inverted assertion fails in.
    expect(JSON.stringify(raw.data)).toContain('inside.txt');
    expect(JSON.stringify(raw.data)).not.toContain('escape/outside.txt');
  });

  it('Grep does not return the out-of-root file CONTENT through the escaping symlink', async () => {
    const grep = createGrepTool({ cwd: workdir });
    const args = { outputMode: 'content' } as const;
    const inRoot = await grep.execute({ ...args, pattern: 'nested-ordinary' } as Parameters<
      typeof grep.execute
    >[0]);
    // Same positive control: the search does reach the files inside the root.
    expect(JSON.stringify(inRoot.data)).toContain('nested-ordinary');

    const raw = await grep.execute({ ...args, pattern: 'SECRET-VALUE' } as Parameters<
      typeof grep.execute
    >[0]);
    expect(JSON.stringify(raw.data)).not.toContain('SECRET-VALUE');
  });
});

describe('tool node — enumeration is confined to the invocation directory (SEC-007)', () => {
  it('does not enumerate through a symlinked directory that escapes the root', async () => {
    const result = await run({ toolName: 'glob', params: { pattern: '**/*.txt' } });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('inside.txt');
    expect(result.output).not.toContain('outside.txt');
  });

  it('refuses an explicit search root outside the invocation directory', async () => {
    const result = await run({ toolName: 'glob', params: { pattern: '*.txt', path: outside } });
    expect(result.output).not.toContain('outside.txt');
  });

  it('does not disclose out-of-root CONTENT via grep', async () => {
    const result = await run({
      toolName: 'grep',
      params: { pattern: 'SECRET-VALUE', outputMode: 'content' },
    });
    expect(result.output).not.toContain('SECRET-VALUE');
  });

  it('still enumerates and searches normally inside the invocation directory', async () => {
    const globbed = await run({ toolName: 'glob', params: { pattern: '**/*.txt' } });
    expect(globbed.isError).toBe(false);
    expect(globbed.output).toContain('inside.txt');
    expect(globbed.output).toContain('nested.txt');

    const grepped = await run({
      toolName: 'grep',
      params: { pattern: 'nested-ordinary', outputMode: 'content' },
    });
    expect(grepped.isError).toBe(false);
    expect(grepped.output).toContain('nested-ordinary');
  });
});

describe('tool node — the file builtins are contained too, not just the file-* nodes', () => {
  it('uses the injected execution root even when the ambient process cwd differs', async () => {
    process.chdir(outside);
    const result = await run({
      toolName: 'read',
      params: { filePath: join(workdir, 'inside.txt') },
    });
    expect(result.isError).toBe(false);
    expect(result.output).toContain('ordinary');
  });

  it('refuses to READ an absolute path outside the invocation directory', async () => {
    const result = await run({
      toolName: 'read',
      params: { filePath: join(outside, 'outside.txt') },
    });
    expect(result.output).not.toContain('SECRET-VALUE');
    expect(result.isError).toBe(true);
  });

  it('refuses to READ through an escaping symlinked directory', async () => {
    const result = await run({ toolName: 'read', params: { filePath: 'escape/outside.txt' } });
    expect(result.output).not.toContain('SECRET-VALUE');
    expect(result.isError).toBe(true);
  });

  it('refuses to WRITE outside the invocation directory, and plants nothing', async () => {
    const target = join(outside, 'planted.sh');
    const result = await run({ toolName: 'write', params: { filePath: target, content: 'x' } });
    expect(result.isError).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('still reads and writes ordinary files inside the invocation directory', async () => {
    const written = await run({
      toolName: 'write',
      params: { filePath: join(workdir, 'out.txt'), content: 'fine' },
    });
    expect(written.isError).toBe(false);

    const read = await run({ toolName: 'read', params: { filePath: join(workdir, 'out.txt') } });
    expect(read.isError).toBe(false);
    expect(read.output).toContain('fine');
  });
});

describe('tool node — config.cwd may narrow the root, never widen it (SEC-007)', () => {
  it('refuses a config.cwd that escapes the invocation directory', async () => {
    const result = await run({
      toolName: 'glob',
      cwd: outside,
      params: { pattern: '*.txt' },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT');
    expect(result.output).not.toContain('outside.txt');
  });

  it('refuses a `..` config.cwd', async () => {
    const result = await run({ toolName: 'glob', cwd: '../outside', params: { pattern: '*.txt' } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT');
  });

  it('refuses a config.cwd reached through an escaping symlink', async () => {
    const result = await run({ toolName: 'glob', cwd: 'escape', params: { pattern: '*.txt' } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT');
  });

  it('honours a config.cwd that NARROWS to a subdirectory', async () => {
    const result = await run({ toolName: 'glob', cwd: 'sub', params: { pattern: '**/*.txt' } });
    expect(result.ok).toBe(true);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('nested.txt');
    expect(result.output).not.toContain('inside.txt');
  });
});
