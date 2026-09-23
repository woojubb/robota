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
    const cwd = tempRoot('robota-cli-untrusted-');
    const userHome = tempRoot('robota-cli-home-');
    gitInit(cwd);
    const previousCwd = process.cwd();
    const previousHome = process.env.HOME;
    const previousArgv = process.argv;
    const previousExitCode = process.exitCode;
    process.chdir(cwd);
    process.env.HOME = userHome;
    process.argv = ['node', 'robota', '-p', 'workspace trust startup probe'];
    process.exitCode = undefined;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const access = await resolveInitialCliWorkspaceProjectAccess(cwd);
      expect(access).toMatchObject({ status: 'restricted', trustState: 'untrusted' });
      expect(requiresHeadlessWorkspaceTrust(access)).toBe(true);
      expect(formatHeadlessWorkspaceTrustError(access, cwd)).toContain(
        'Project settings, hooks, plugins, skills, and provider overrides were not loaded.',
      );

      await startCli({ providerDefinitions: [] });

      expect(process.exitCode).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain('Workspace trust is required');
    } finally {
      process.chdir(previousCwd);
      process.env.HOME = previousHome;
      process.argv = previousArgv;
      process.exitCode = previousExitCode;
    }
  });

  it('supports a host-owned grant and revocation without exposing a credential', async () => {
    const cwd = tempRoot('robota-cli-trust-command-');
    const storePath = join(tempRoot('robota-cli-trust-store-'), 'trust.json');
    gitInit(cwd);
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(storePath),
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runWorkspaceTrustCommand(['--yes'], cwd, service)).resolves.toBe(0);
    await expect(runWorkspaceTrustCommand(['revoke', '--yes'], cwd, service)).resolves.toBe(1);
    const output = stdout.mock.calls.flat().join('');
    expect(output).toContain('Workspace trust: trusted');
    expect(output).toContain('Workspace trust: revoked');
    expect(output).not.toContain('apiKey');
    expect(output).not.toContain('secret');
  });

  it('previews owner-declared project sources without loading their content before trust', async () => {
    const cwd = tempRoot('robota-cli-trust-preview-');
    const storePath = join(tempRoot('robota-cli-trust-preview-store-'), 'trust.json');
    gitInit(cwd);
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    writeFileSync(join(cwd, '.robota', 'settings.json'), 'secret-value-never-print');
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(storePath),
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runWorkspaceTrustCommand(['status'], cwd, service)).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join('');
    expect(output).toContain('Project sources');
    expect(output).toContain('.robota/settings.json');
    expect(output).toContain('.robota/plugins');
    expect(output).toContain('.robota/skills');
    expect(output).toContain('.agents/agents');
    expect(output).toContain('.robota/memory');
    expect(output).toContain('.robota/sessions');
    expect(output).toContain('.robota/logs');
    expect(output).toContain('.robota/checkpoints');
    expect(output).toContain('.agents/tasks');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('CLAUDE.md');
    expect(output).toContain('.robota/output-styles');
    expect(output).toContain('.robota/budget.json');
    expect(output).not.toContain('secret-value-never-print');
  });

  it('includes ancestor context and cwd-local plugin/style roots from a nested directory', async () => {
    const root = tempRoot('robota-cli-nested-preview-');
    const cwd = join(root, 'packages', 'example');
    const storePath = join(tempRoot('robota-cli-nested-preview-store-'), 'trust.json');
    gitInit(root);
    mkdirSync(cwd, { recursive: true });
    const service = new WorkspaceTrustService({
      identityResolver: createNodeWorkspaceIdentityResolver(),
      store: createNodeWorkspaceTrustStore(storePath),
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runWorkspaceTrustCommand(['status'], cwd, service)).resolves.toBe(0);

    const output = stdout.mock.calls.flat().join('');
    expect(output).toContain('packages/example/AGENTS.md');
    expect(output).toContain('packages/example/CLAUDE.md');
    expect(output).toContain('packages/example/.robota/plugins');
    expect(output).toContain('packages/example/.robota/output-styles');
  });
});
