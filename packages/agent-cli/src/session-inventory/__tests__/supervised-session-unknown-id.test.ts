import { createInventoryRuntime as createTestProductRuntime } from './product-runtime.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';

const UNKNOWN = '11111111-1111-4111-8111-111111111111';
const PR = 'https://github.com/team/repo/pull/123';

/** Every command that takes a supervised session id and acts on its live owner. */
const ID_COMMANDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['session stop', ['session', 'stop', UNKNOWN]],
  ['session rename', ['session', 'rename', UNKNOWN, 'Evening review']],
  ['session link-pr', ['session', 'link-pr', UNKNOWN, PR]],
  ['session unlink-pr', ['session', 'unlink-pr', UNKNOWN]],
  ['session events list', ['session', 'events', 'list', UNKNOWN]],
  ['session events list --json', ['session', 'events', 'list', UNKNOWN, '--json']],
  ['session events revoke', ['session', 'events', 'revoke', UNKNOWN, 'grant-1']],
];

let cwd: string;
let previousExitCode: typeof process.exitCode;
let stdout: MockInstance<typeof process.stdout.write>;
let stderr: MockInstance<typeof process.stderr.write>;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'rs-unknown-id-'));
  previousExitCode = process.exitCode;
  process.exitCode = 0;
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  process.exitCode = previousExitCode;
  rmSync(cwd, { recursive: true, force: true });
});

async function run(args: readonly string[]): Promise<{ readonly exit: number | undefined; readonly out: string; readonly err: string }> {
  stdout.mockClear();
  stderr.mockClear();
  process.exitCode = 0;
  const handled = await runPreparsedCliCommand(
    { productRuntime: createTestProductRuntime(), providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd) },
    ['node', 'test-product', ...args],
    cwd,
  );
  expect(handled).toBe(true);
  const text = (spy: MockInstance<typeof process.stdout.write>): string => spy.mock.calls.map(([chunk]) => String(chunk)).join('');
  return { exit: process.exitCode as number | undefined, out: text(stdout), err: text(stderr) };
}

describe('an id-addressed supervised session command given an id that is not registered', () => {
  it.each(ID_COMMANDS)('%s says that no such supervised session exists, without naming a path', async (_name, args) => {
    const result = await run(args);
    expect(result.exit).toBe(1);
    expect(result.out).toBe('');
    expect(result.err).toBe(`No supervised session ${UNKNOWN} exists.\n`);
    expect(result.err).not.toMatch(/ENOENT|lstat|no such file/iu);
    expect(result.err).not.toMatch(/[\\/]/u);
    expect(result.err).not.toContain(createTestProductRuntime().layout.userRoot);
  });

  it.each(ID_COMMANDS)('%s says the same once the supervised directory exists without that id', async (_name, args) => {
    mkdirSync(join(createTestProductRuntime().layout.userRoot, 'supervised'), { recursive: true, mode: 0o700 });
    const result = await run(args);
    expect(result.exit).toBe(1);
    expect(result.err).toBe(`No supervised session ${UNKNOWN} exists.\n`);
  });

  it.each([
    ['session stop', ['session', 'stop', '../escape']],
    ['session rename', ['session', 'rename', '../escape', 'Evening review']],
    ['session events list', ['session', 'events', 'list', '../escape']],
    ['session events revoke', ['session', 'events', 'revoke', '../escape', 'grant-1']],
  ] as const)('%s still refuses an id that is not well-formed with the same words as before', async (_name, args) => {
    const result = await run(args);
    expect(result.exit).toBe(1);
    expect(result.err).toBe('Invalid supervised session ID.\n');
  });
});
