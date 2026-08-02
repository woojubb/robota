/**
 * SEC-007 — the shell tool's `cwd`: a DEFAULT, deliberately not a boundary.
 *
 * The sweep that produced SEC-007 found `Shell` spawning with an unguarded `cwd`. Applying the file
 * tools' containment guard here was rejected on the merits: this tool runs an arbitrary command, so a
 * `cwd` guard is undone by the first `cd ..` — it would constrain nothing while READING as a boundary
 * in review, which is precisely the failure SEC-006's R9 recorded ("'the guard is still there' is not
 * a verdict"). The real boundary is the permission layer and the sandbox seam.
 *
 * What WAS wrong is separate and is fixed here: the tool ignored the containment root it was
 * constructed with and ran every command in `process.cwd()`. An assembly could scope its file tools
 * to a workspace and still shell out somewhere else entirely.
 *
 * The second describe block is a CONTROL: it pins the non-containment as a decision that a future
 * reader must overturn explicitly, rather than an omission they might "fix" by reflex.
 */

import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createShellTool } from '../builtins/shell-tool.js';

import type { IToolInvocationResult } from '../types/tool-result.js';
import type { FunctionTool, TToolParameters } from '@robota-sdk/agent-core';

/**
 * Every case here SPAWNS A REAL SHELL, so vitest's 10 s default — sized for in-process units — is the
 * wrong bound; `shell-tool.test.ts` flaked at exactly that wall against PowerShell on a Windows
 * runner. What is under test is which directory the command runs in, never how fast the OS starts it.
 */
const SPAWN_TIMEOUT_MS = 60_000;

let root: string;
let workdir: string;
let sibling: string;

async function runTool(tool: FunctionTool, args: TToolParameters): Promise<IToolInvocationResult> {
  const raw = await tool.execute(args, { toolName: tool.getName(), parameters: args });
  return JSON.parse(raw.data as string) as IToolInvocationResult;
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sec007-shell-')));
  workdir = join(root, 'workdir');
  sibling = join(root, 'sibling');
  mkdirSync(workdir, { recursive: true });
  mkdirSync(sibling, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Shell — the configured containment root is the DEFAULT working directory (SEC-007)', () => {
  it(
    'runs in the configured cwd, not the host process cwd',
    async () => {
      const result = await runTool(createShellTool({ cwd: workdir }), { command: 'pwd' });
      expect(result.success).toBe(true);
      expect(realpathSync(result.output.trim())).toBe(workdir);
      expect(realpathSync(result.output.trim())).not.toBe(realpathSync(process.cwd()));
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'still honours an explicit workingDirectory over the default',
    async () => {
      const result = await runTool(createShellTool({ cwd: workdir }), {
        command: 'pwd',
        workingDirectory: sibling,
      });
      expect(realpathSync(result.output.trim())).toBe(sibling);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'runs in the host process cwd when that is the configured root',
    async () => {
      // ARCH-010 made `cwd` REQUIRED, so "no root configured" is no longer constructible through the
      // factory — a caller that means the host process directory now says so where a reader can see it.
      // The observable this case was always about is unchanged: that directory is where the command runs.
      const result = await runTool(createShellTool({ cwd: process.cwd() }), { command: 'pwd' });
      expect(realpathSync(result.output.trim())).toBe(realpathSync(process.cwd()));
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('CONTROL — Shell is NOT path-contained, and that is the decision (SEC-007)', () => {
  it(
    'an explicit out-of-root workingDirectory still runs',
    async () => {
      // Not a defect to fix by adding `checkPathWithinCwd` here: the very next line demonstrates why
      // such a guard would be cosmetic.
      const result = await runTool(createShellTool({ cwd: workdir }), {
        command: 'pwd',
        workingDirectory: sibling,
      });
      expect(result.success).toBe(true);
      expect(realpathSync(result.output.trim())).toBe(sibling);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'a guard on workingDirectory would be undone by the command itself',
    async () => {
      // The command escapes without touching `workingDirectory` at all. Any containment check on the
      // cwd argument is therefore not a boundary — it is a boundary-shaped comment.
      const result = await runTool(createShellTool({ cwd: workdir }), {
        command: `cd ${JSON.stringify(sibling)} && pwd`,
      });
      expect(result.success).toBe(true);
      expect(realpathSync(result.output.trim())).toBe(sibling);
    },
    SPAWN_TIMEOUT_MS,
  );
});
