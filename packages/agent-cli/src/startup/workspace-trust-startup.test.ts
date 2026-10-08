import { createTestProductRuntime } from '../__tests__/helpers/product-runtime.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceTrustService,
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustStore,
} from '@robota-sdk/agent-framework';

import { startCli } from '../cli.js';
import { runWorkspaceTrustCommand } from './workspace-trust-command.js';
import {
  formatHeadlessWorkspaceTrustError,
  requiresHeadlessWorkspaceTrust,
} from './workspace-trust-admission.js';
import { resolveInitialCliWorkspaceProjectAccess } from './workspace-project-composition.js';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function gitInit(root: string): void {
  execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CLI workspace trust admission', () => {
  it('resolves an untrusted Git workspace before normal startup and refuses headless execution', async () => {
    const cwd = tempRoot('test-product-cli-untrusted-');
    const userHome = tempRoot('test-product-cli-home-');
    gitInit(cwd);
    const previousCwd = process.cwd();
    const previousHome = process.env.HOME;
    const previousArgv = process.argv;
    const previousExitCode = process.exitCode;
    process.chdir(cwd);
    process.env.HOME = userHome;
    process.argv = ['node', 'test-product', '-p', 'workspace trust startup probe'];
    process.exitCode = undefined;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const access = await resolveInitialCliWorkspaceProjectAccess(cwd, { productRuntime: createTestProductRuntime() });
      expect(access).toMatchObject({ status: 'restricted', trustState: 'untrusted' });
      expect(requiresHeadlessWorkspaceTrust(access)).toBe(true);
      expect(formatHeadlessWorkspaceTrustError(access, cwd, 'test-product')).toContain(
        'Project settings, hooks, plugins, skills, and provider overrides were not loaded.',
      );

      await startCli({productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),  providerDefinitions: [] });

      expect(process.exitCode).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain('Workspace trust is required');
      expect(stderr.mock.calls.flat().join('')).toContain('test-product trust --yes');
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
      process.argv = previousArgv;
      process.exitCode = previousExitCode;
    }
  });

  it('#3282 §3: refuses `--serve --open` with no TTY to ask on, naming --restricted-workspace too', async () => {
    const cwd = tempRoot('test-product-cli-serve-open-untrusted-');
    const userHome = tempRoot('test-product-cli-serve-open-home-');
    gitInit(cwd);
    const previousCwd = process.cwd();
    const previousHome = process.env.HOME;
    const previousArgv = process.argv;
    const previousExitCode = process.exitCode;
    process.chdir(cwd);
    process.env.HOME = userHome;
    // Never a real TTY in this test process, so a stubbed refusal to ask must not be reachable —
    // the child assertion below only holds if the code never opened a real readline prompt.
    process.argv = ['node', 'test-product', '--serve', '--open'];
    process.exitCode = undefined;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await startCli({productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),  providerDefinitions: [] });

      expect(process.exitCode).toBe(1);
      const written = stderr.mock.calls.flat().join('');
      expect(written).toContain('Workspace trust is required');
      expect(written).toContain('Or start without project sources with: --restricted-workspace');
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
      process.argv = previousArgv;
      process.exitCode = previousExitCode;
    }
  });

  it('#3282 §3: plain --serve (no --open) still refuses outright, even with a TTY', async () => {
    const cwd = tempRoot('test-product-cli-serve-only-untrusted-');
    const userHome = tempRoot('test-product-cli-serve-only-home-');
    gitInit(cwd);
    const previousCwd = process.cwd();
    const previousHome = process.env.HOME;
    const previousArgv = process.argv;
    const previousExitCode = process.exitCode;
    const previousStdinTty = process.stdin.isTTY;
    const previousStdoutTty = process.stdout.isTTY;
    process.chdir(cwd);
    process.env.HOME = userHome;
    process.argv = ['node', 'test-product', '--serve'];
    process.exitCode = undefined;
    // A TTY alone is not enough — only `--serve --open` gets the interactive ask, so this must still
    // refuse without ever touching the terminal (no injected answer is given).
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await startCli({productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),  providerDefinitions: [] });

      expect(process.exitCode).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain('Workspace trust is required');
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
      process.argv = previousArgv;
      process.exitCode = previousExitCode;
      process.stdin.isTTY = previousStdinTty;
      process.stdout.isTTY = previousStdoutTty;
    }
  });

  it('supports a host-owned grant and revocation without exposing a credential, and a successful revoke exits 0', async () => {
    const cwd = tempRoot('test-product-cli-trust-command-');
    const storePath = join(tempRoot('test-product-cli-trust-store-'), 'trust.json');
    gitInit(cwd);
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(storePath),
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runWorkspaceTrustCommand(['--yes'], cwd, createTestProductRuntime('test-product', { HOME: process.env['HOME'] }), service)).resolves.toBe(0);
    await expect(runWorkspaceTrustCommand(['revoke', '--yes'], cwd, createTestProductRuntime('test-product', { HOME: process.env['HOME'] }), service)).resolves.toBe(0);
    const output = stdout.mock.calls.flat().join('');
    expect(output).toContain('Workspace trust: trusted');
    expect(output).toContain('Workspace trust: revoked');
    expect(output).not.toContain('apiKey');
    expect(output).not.toContain('secret');
  });

  it('previews owner-declared project sources without loading their content before trust', async () => {
    const cwd = tempRoot('test-product-cli-trust-preview-');
    const storePath = join(tempRoot('test-product-cli-trust-preview-store-'), 'trust.json');
    gitInit(cwd);
    mkdirSync(join(cwd, '.test-product'), { recursive: true });
    writeFileSync(join(cwd, '.test-product', 'settings.json'), 'secret-value-never-print');
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(storePath),
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runWorkspaceTrustCommand(['status'], cwd, createTestProductRuntime('test-product', { HOME: process.env['HOME'] }), service)).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join('');
    expect(output).toContain('Project sources');
    expect(output).toContain('.test-product/settings.json');
    expect(output).toContain('.test-product/plugins');
    expect(output).toContain('.test-product/skills');
    expect(output).toContain('.agents/agents');
    expect(output).toContain('.test-product/memory');
    expect(output).toContain('.test-product/sessions');
    expect(output).toContain('.test-product/logs');
    expect(output).toContain('.test-product/checkpoints');
    expect(output).toContain('.test-product/tasks');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('CLAUDE.md');
    expect(output).toContain('.test-product/output-styles');
    expect(output).toContain('.test-product/budget.json');
    expect(output).toContain('package.json');
    expect(output).toContain('tsconfig.json');
    expect(output).toContain('pnpm-lock.yaml');
    expect(output).toContain('pyproject.toml');
    expect(output).toContain('Cargo.toml');
    expect(output).toContain('go.mod');
    expect(output).not.toContain('secret-value-never-print');
  });

  it('includes ancestor context and cwd-local plugin/style roots from a nested directory', async () => {
    const root = tempRoot('test-product-cli-nested-preview-');
    const cwd = join(root, 'packages', 'example');
    const storePath = join(tempRoot('test-product-cli-nested-preview-store-'), 'trust.json');
    gitInit(root);
    mkdirSync(cwd, { recursive: true });
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(storePath),
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runWorkspaceTrustCommand(['status'], cwd, createTestProductRuntime('test-product', { HOME: process.env['HOME'] }), service)).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join('');
    expect(output).toContain('packages/example/AGENTS.md');
    expect(output).toContain('packages/example/CLAUDE.md');
    expect(output).toContain('packages/example/.test-product/plugins');
    expect(output).toContain('packages/example/.test-product/output-styles');
  });
});
