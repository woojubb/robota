/**
 * SEC-007 — the file-tool sandbox must cover the tools that ENUMERATE, not only the ones that read.
 *
 * SEC-006 fixed `checkPathWithinCwd` (Read/Write/Edit) to decide containment on the CANONICAL path.
 * It also recorded that `Glob` and `Grep` never called that guard at all: both resolved an
 * LLM-supplied root against `process.cwd()` and walked it, and neither factory even ACCEPTED the
 * session's containment root — `createDefaultTools`/`createCodingPack` registered the two
 * module-level singletons, so there was nothing to bind a sandbox to. A sandbox that stops you
 * reading a file but lets you enumerate the filesystem around it is not a sandbox, and `Grep` in
 * `content` mode returns the matching LINES, so it discloses file contents outright.
 *
 * These tests plant REAL files and REAL symlinks on disk. The path-guard hole survived for a long
 * time precisely because the existing suite only ever passed fictional path strings, so nothing was
 * ever on disk to escape to; a test that cannot observe a symlink cannot observe this class of bug.
 *
 * The markers are ASSEMBLED at runtime rather than written as literals: a `Grep` that is not yet
 * contained searches `process.cwd()` — the repository — and would MATCH THIS FILE, turning a real
 * breach into an accidental green (or, as first observed, an accidental red).
 *
 * NOTE on the wrong turn SEC-006 recorded: rejecting `.`/`..`/separator SEGMENTS does not fix this.
 * A symlink named `escape` is a perfectly plain segment. Containment is a canonical-path decision.
 */

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createGlobTool } from '../builtins/glob-tool.js';
import { createGrepTool } from '../builtins/grep-tool.js';

import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool, TToolParameters } from '@robota-sdk/agent-core';

/** Only ever written OUTSIDE the sandbox; seeing it in a tool result is a breach. Assembled, never literal. */
const CANARY = ['SEC007', 'OUT', 'OF', 'ROOT', Date.now().toString(36)].join('-');
/** Only ever written INSIDE the sandbox — proves the tool still works after containment. */
const INSIDE_MARKER = ['SEC007', 'IN', 'SANDBOX', Date.now().toString(36)].join('-');

let root: string;
let workdir: string;
let outside: string;

async function runTool(tool: FunctionTool, args: TToolParameters): Promise<IToolInvocationResult> {
  const raw = await tool.execute(args, { toolName: tool.getName(), parameters: args });
  return JSON.parse(raw.data as string) as IToolInvocationResult;
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sec007-')));
  workdir = join(root, 'workdir');
  outside = join(root, 'outside');
  mkdirSync(join(workdir, 'src'), { recursive: true });
  mkdirSync(outside, { recursive: true });

  writeFileSync(join(workdir, 'src', 'inside.txt'), `${INSIDE_MARKER}\n`);
  writeFileSync(join(outside, 'secret.txt'), `${CANARY}\n`);
  writeFileSync(join(outside, 'other.txt'), `${CANARY} again\n`);

  // An ordinary committed-symlink shape: a link INSIDE the sandbox pointing out of it.
  symlinkSync(outside, join(workdir, 'escape'));
  symlinkSync(join(outside, 'secret.txt'), join(workdir, 'secret-link.txt'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * CONTROL — pins WHY the fix is shaped the way it is (the same role SEC-006's R4 control test played).
 *
 * With no containment root the tools are unchanged: an escaping symlink is followed and out-of-root
 * content is returned. This is the exact behaviour the contained cases below must NOT show, and it is
 * what every registered `Glob`/`Grep` did before SEC-007, because the factories took no `cwd` at all.
 */
describe('CONTROL — an unconstrained Glob/Grep really does escape through the symlink', () => {
  it('Glob enumerates out-of-root files through the escaping symlink', async () => {
    const result = await runTool(createGlobTool(), { pattern: '**/*.txt', path: workdir });
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/escape\/secret\.txt/);
  });

  it('Grep returns the out-of-root file CONTENT through the escaping symlink', async () => {
    const result = await runTool(createGrepTool(), {
      pattern: CANARY,
      path: workdir,
      outputMode: 'content',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain(CANARY);
  });
});

describe('Glob — enumeration is confined to the sandbox root (SEC-007)', () => {
  it('does not enumerate through a symlinked directory that escapes cwd', async () => {
    const result = await runTool(createGlobTool({ cwd: workdir }), { pattern: '**/*.txt' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('inside.txt');
    // `escape/secret.txt` names a file whose real location is outside the sandbox.
    expect(result.output).not.toMatch(/escape\//);
    expect(result.output).not.toMatch(/secret\.txt/);
  });

  it('refuses an explicit search root outside cwd', async () => {
    const result = await runTool(createGlobTool({ cwd: workdir }), {
      pattern: '*.txt',
      path: outside,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the working directory/);
    expect(result.output).not.toContain('secret.txt');
  });

  it('refuses a search root reached through an escaping symlink', async () => {
    const result = await runTool(createGlobTool({ cwd: workdir }), {
      pattern: '*.txt',
      path: join(workdir, 'escape'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the working directory/);
  });

  it('does not enumerate out of the sandbox via a `..` pattern', async () => {
    const result = await runTool(createGlobTool({ cwd: workdir }), { pattern: '../outside/*.txt' });
    expect(result.output).not.toMatch(/secret\.txt|other\.txt/);
  });

  it('resolves a RELATIVE search root against the sandbox root, not process.cwd()', async () => {
    const result = await runTool(createGlobTool({ cwd: workdir }), {
      pattern: '*.txt',
      path: 'src',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('inside.txt');
  });

  it('still enumerates normally inside the sandbox', async () => {
    const result = await runTool(createGlobTool({ cwd: workdir }), { pattern: 'src/*.txt' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('inside.txt');
  });
});

describe('Grep — content search is confined to the sandbox root (SEC-007)', () => {
  it('does not return out-of-root CONTENT reached through a symlinked directory', async () => {
    const result = await runTool(createGrepTool({ cwd: workdir }), {
      pattern: CANARY,
      outputMode: 'content',
    });
    expect(result.output).not.toContain(CANARY);
  });

  it('does not read a symlinked FILE inside cwd whose target is outside', async () => {
    const result = await runTool(createGrepTool({ cwd: workdir }), {
      pattern: CANARY,
      path: join(workdir, 'secret-link.txt'),
      outputMode: 'content',
    });
    expect(result.success).toBe(false);
    expect(result.output).not.toContain(CANARY);
  });

  it('refuses an explicit search root outside cwd', async () => {
    const result = await runTool(createGrepTool({ cwd: workdir }), {
      pattern: CANARY,
      path: outside,
      outputMode: 'content',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the working directory/);
    expect(result.output).not.toContain(CANARY);
  });

  it('does not disclose out-of-root file NAMES in files_with_matches mode either', async () => {
    const result = await runTool(createGrepTool({ cwd: workdir }), {
      pattern: CANARY,
      outputMode: 'files_with_matches',
    });
    expect(result.output).not.toMatch(/secret\.txt|other\.txt/);
  });

  it('still searches normally inside the sandbox', async () => {
    const result = await runTool(createGrepTool({ cwd: workdir }), {
      pattern: INSIDE_MARKER,
      outputMode: 'content',
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('inside.txt');
  });
});
