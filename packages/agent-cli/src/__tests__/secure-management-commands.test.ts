/**
 * The invocations that are no conversation surface — help, version, a parse error, the session
 * listing, the doctor, MCP management, an evaluation, the direct user-local command — run in secure
 * conversations without a key holder and without a session store ever being built for them. They go
 * through the real startup of a state root with secure mode on; the one thing the test replaces is
 * the process exit, so a command that ends there can be told apart.
 *
 * The commands that read saved conversations (`usage`, `usage export`, `session analyze`) are the
 * counter-case: with no key holder they still refuse, as every store does, rather than open one.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { productKeyHolder } from '../product/session-sealing.js';
import { createTestProductRuntime } from './helpers/product-runtime.js';
import { enableSecureConversations, resolveSecureRuntime } from './helpers/secure-product-state.js';

const testHost = createTestFrameworkHost();

/** Every conversation store a process builds comes from the product factory; each attempt is recorded. */
const stores = vi.hoisted(() => ({ built: [] as string[] }));
vi.mock('../product/session-stores.js', async (original) => {
  const actual = await original<typeof import('../product/session-stores.js')>();
  const recorded =
    <A extends unknown[], R>(name: string, build: (...args: A) => R) =>
    (...args: A): R => {
      stores.built.push(name);
      return build(...args);
    };
  return {
    ...actual,
    createProductUserSessionStore: recorded('user', actual.createProductUserSessionStore),
    createProductProjectSessionStore: recorded('project', actual.createProductProjectSessionStore),
    createProductEditCheckpointStoreFactory: recorded(
      'checkpoints',
      actual.createProductEditCheckpointStoreFactory,
    ),
    createProductPromptHistoryFile: recorded('history', actual.createProductPromptHistoryFile),
    createProductToolResultSpillStore: recorded('spill', actual.createProductToolResultSpillStore),
  };
});
const { startCliCore } = await import('../cli-core.js');

const REFUSAL =
  'Secure conversation sealing key holder is unavailable; no conversation store may open.';
const roots: string[] = [];
const originalExitCode = process.exitCode;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  stores.built.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Starts the CLI on `argv` in a fresh state root with secure conversations on. */
async function run(argv: readonly string[]) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-secure-management-')));
  roots.push(home);
  mkdirSync(join(home, 'project'));
  vi.stubEnv('HOME', home);
  vi.spyOn(process, 'cwd').mockReturnValue(join(home, 'project'));
  const plain = createTestProductRuntime('test-product', { HOME: home });
  await enableSecureConversations(plain);
  const runtime = resolveSecureRuntime(plain);
  let out = '';
  let err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => ((out += String(text)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((text) => ((err += String(text)), true));
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${String(code)}`);
  });
  process.exitCode = undefined;
  const previous = process.argv;
  process.argv = ['node', 'test-product', ...argv];
  try {
    const outcome = await startCliCore(
      {
        productRuntime: runtime,
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted'),
      },
      testHost,
      () => [],
    ).then(
      () => 'returned',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    return { runtime, outcome, out, err, exitCode: process.exitCode, built: [...stores.built] };
  } finally {
    process.argv = previous;
  }
}

describe('invocations that read no conversation, in secure conversations', () => {
  it.each([
    ['--help', ['--help'], 'Usage: test-product [options]'],
    ['-h', ['-h'], 'Usage: test-product [options]'],
    ['--version', ['--version'], 'test-product '],
  ])('%s prints and returns', async (_name, argv, expected) => {
    const result = await run(argv);

    expect(result.outcome).toBe('returned');
    expect(result.out).toContain(expected);
    expect(result.err).toBe('');
    expect(result.exitCode).toBeUndefined();
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('reports a parse error as the parser does, not as a refusal to open a store', async () => {
    const result = await run(['--no-such-option']);

    expect(result.outcome).toBe('exit 1');
    expect(result.err).toContain("Unknown option '--no-such-option'");
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it.each([
    ['usage --help', ['usage', '--help']],
    ['usage -h', ['usage', '-h']],
    ['usage export --help', ['usage', 'export', '--help']],
  ])('%s prints its help and builds no store', async (_name, argv) => {
    const result = await run(argv);

    expect(result.outcome).toBe('returned');
    expect(result.out).toContain('Usage:');
    expect(result.exitCode).toBe(0);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('lists live and supervised sessions and says the saved ones are sealed', async () => {
    const result = await run(['session', 'list']);

    expect(result.outcome).toBe('returned');
    expect(result.exitCode).toBe(0);
    expect(result.out).toContain('Live processes (not linked to saved sessions):\n  (none)');
    expect(result.out).toContain(
      'Saved sessions (not linked to live processes):\n  Saved sessions are sealed in secure mode and are not listed here; run /unlock in the terminal, then /resume.',
    );
    expect(result.out).toContain(
      'Supervised sessions (owned, not linked to peers or saved records):\n  (none)',
    );
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('marks the saved sessions of the JSON listing as sealed, never as none', async () => {
    const result = await run(['session', 'list', '--format', 'json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
      savedSealed: true,
      supervised: { status: 'available', sessions: [] },
    });
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('prints the help of the session listing', async () => {
    const result = await run(['session', 'list', '--help']);

    expect(result.out).toBe('Usage: test-product session list [--format text|json]\n');
    expect(result.exitCode).toBe(0);
    expect(result.built).toEqual([]);
  });

  it('answers a release of a session that holds no writer marker', async () => {
    const result = await run([
      'session',
      'release',
      'session_00000000-0000-4000-8000-000000000000',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain('has no writer marker; nothing to release.');
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('diagnoses with the doctor and composes no store, so no check fails for want of a key holder', async () => {
    const result = await run(['doctor']);

    expect(result.out).toContain('test-product doctor');
    expect(result.out).toContain('Settings layer');
    expect(result.out).not.toContain('Workspace composition');
    expect(`${result.out}${result.err}`).not.toContain('key holder');
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it.each([
    ['mcp login', ['mcp', 'login', 'nope'], 'No MCP server named "nope" is configured.'],
    ['mcp logout', ['mcp', 'logout', 'nope'], 'No MCP server named "nope" is configured.'],
    ['mcp add', ['mcp', 'add', 'exa'], 'runs only in an interactive terminal'],
  ])('routes %s to its own answer', async (_name, argv, expected) => {
    const result = await run(argv);

    expect(result.exitCode).toBe(1);
    expect(result.err).toContain(expected);
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('runs an evaluation to its own failure for a definition that is not there', async () => {
    const result = await run(['eval', 'missing-definition.json']);

    expect(result.exitCode).toBe(1);
    expect(result.err).toContain('Failed to load eval definition');
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('runs the direct user-local command to its own usage', async () => {
    const result = await run(['user-local']);

    expect(result.outcome).toBe('exit 1');
    expect(result.err).toContain('Usage: user-local');
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('resets the configuration without a key holder, as it needs none', async () => {
    const result = await run(['--reset', '--yes']);

    expect(result.outcome).toBe('returned');
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });
});

describe('commands that read saved conversations, in secure conversations', () => {
  it.each([
    ['usage', ['usage']],
    ['usage --format json', ['usage', '--format', 'json']],
    ['usage export', ['usage', 'export', '--endpoint', 'http://127.0.0.1:9']],
    ['session analyze', ['session', 'analyze']],
  ])('%s still refuses without a key holder, and is given none', async (_name, argv) => {
    const result = await run(argv);

    expect(result.outcome).toBe(REFUSAL);
    expect(result.out).toBe('');
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });
});
