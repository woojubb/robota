import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { withholdProviderCredentials } from '../command-environment.js';
import { createProductWorktreeAdapter } from '../subagent-composition.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

const SECRET = 'WORKTREE_HOOK_PROBE_KEY';
const definitions = [{ type: 'openai', defaults: {} }] as unknown as IProviderDefinition[];
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: gitEnvironment() });
}

/** A repository whose `post-checkout` hook — workspace content — records what it was handed. */
function repositoryWithProbeHook(root: string): { repo: string; probe: string } {
  const repo = join(root, 'repo');
  const probe = join(root, 'probe.txt');
  mkdirSync(join(repo, '.hooks'), { recursive: true });
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'core.hooksPath', '.hooks']);
  const hook = join(repo, '.hooks', 'post-checkout');
  writeFileSync(hook, `#!/bin/sh\nprintf '%s' "\${${SECRET}:-absent}" > '${probe}'\n`);
  chmodSync(hook, 0o755);
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'initial']);
  return { repo, probe };
}

describe('the isolated-subagent worktree adapter', () => {
  it.skipIf(process.platform === 'win32')(
    'never hands a withheld credential to the git hooks it runs',
    () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-worktree-env-')));
      roots.push(root);
      const settingsPath = join(root, 'user-settings.json');
      writeFileSync(
        settingsPath,
        JSON.stringify({ providers: { main: { type: 'openai', model: 'm', apiKey: `$ENV:${SECRET}` } } }),
      );
      // The runtime withholds the provider's credential from its commands, as startup does.
      withholdProviderCredentials([createNodeHostSettingsSource('user', settingsPath)], definitions, {
        [SECRET]: 'snapshot-key',
      });
      const runtime = createTestProductRuntime('test-product', { [SECRET]: 'snapshot-key', PATH: process.env['PATH'] });
      const { repo, probe } = repositoryWithProbeHook(root);

      createProductWorktreeAdapter(runtime).prepare({ taskId: 'agent_1', cwd: repo });

      expect(readFileSync(probe, 'utf8')).toBe('absent');
    },
    20_000,
  );
});
