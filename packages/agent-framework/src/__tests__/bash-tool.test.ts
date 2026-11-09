/**
 * Tests for BashTool
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { createBashTool } from '@robota-sdk/agent-tools/node';
import { describe, expect, it, onTestFinished } from 'vitest';

import { stderrCommand } from '../testing/shell-command-fixture.js';

import type { TToolParameters } from '@robota-sdk/agent-core';
import type { IToolInvocationResult } from '@robota-sdk/agent-tools';

/**
 * The context-free `bashTool` singleton is gone and `cwd` is required. For the shell family
 * `cwd` is the DEFAULT WORKING DIRECTORY and deliberately not a containment boundary, so the host process
 * directory is what these cases already ran in; it is now said out loud. No case here reads or writes a
 * file — the two that care about a directory pass `workingDirectory` explicitly.
 */
const bashTool = createBashTool({ cwd: process.cwd() });

async function run(params: TToolParameters): Promise<IToolInvocationResult> {
  const rawResult = await bashTool.execute(params);
  // rawResult.data is the JSON string returned by the handler
  return JSON.parse(rawResult.data as string) as IToolInvocationResult;
}

// The first PowerShell a Windows runner starts takes seconds, and the default is five.
describe('BashTool', { timeout: 30_000 }, () => {
  it('executes a simple command and returns stdout', async () => {
    const result = await run({ command: 'echo hello' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toContain('hello');
    expect(result.exitCode).toBe(0);
  });

  it('captures stderr output', async () => {
    const result = await run({ command: stderrCommand('error-msg') });
    expect(result.success).toBe(true);
    expect(result.output).toContain('error-msg');
  });

  it('returns success:true with non-zero exitCode for failing commands', async () => {
    const result = await run({ command: 'exit 42' });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  it('honours timeout and returns success:false on timeout', async () => {
    const result = await run({ command: 'sleep 10', timeout: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('uses workingDirectory when specified', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-bash-cwd-'));
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    const result = await run({ command: 'pwd', workingDirectory: directory });
    expect(result.success).toBe(true);
    // The directory's own name survives every spelling of its parents (a symlinked /tmp on macOS,
    // an 8.3 short name on Windows), and PowerShell prints its location under a header.
    expect(result.output).toContain(basename(directory));
  });

  it('runs multi-line shell commands', async () => {
    const result = await run({ command: 'echo line1\necho line2' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('line1');
    expect(result.output).toContain('line2');
  });

  it('handles command not found gracefully', async () => {
    const result = await run({ command: 'this_command_does_not_exist_xyz' });
    // Shell will return non-zero exit with error in stderr
    expect(result.success).toBe(true); // command ran, shell reported error
    expect(result.exitCode).not.toBe(0);
  });

  // --- P1: non-existent workingDirectory ---

  it('returns error for non-existent workingDirectory', async () => {
    // Missing inside a private directory, so no other user can create it first.
    const parent = mkdtempSync(join(tmpdir(), 'agent-bash-missing-'));
    onTestFinished(() => rmSync(parent, { recursive: true, force: true }));
    const result = await run({
      command: 'echo hello',
      workingDirectory: join(parent, 'nonexistent'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
