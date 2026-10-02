import { createTestBinaryEnvironment } from './helpers/product-runtime.js';
/**
 * Issue #3268: a headless start that a person chose to run Restricted (a background session started
 * Restricted from the session view) is not refused for want of trust; without that choice it still is.
 * Runs the repo's CLI from source, as the session view's background start does.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'test-product-restricted-headless-')));
const home = path.join(scratch, 'home');
const repo = path.join(scratch, 'repo');
mkdirSync(home);
execFileSync('git', ['init', '--quiet', repo]);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function printRun(extra: readonly string[]): { status: number | null; stderr: string } {
  const result = spawnSync(launcher, ['-p', 'hello', ...extra], {
    cwd: repo,
    env: createTestBinaryEnvironment(home),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stderr: result.stderr };
}

describe('a headless start in an untrusted repository', () => {
  it('is refused for want of trust', () => {
    const run = printRun([]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Workspace trust is required before headless startup');
  }, 70_000);

  it('is not refused for want of trust when it asked to run Restricted', () => {
    const run = printRun(['--restricted-workspace']);
    // It gets past the trust gate; with no provider configured it stops at that instead.
    expect(run.stderr).not.toContain('Workspace trust is required');
    expect(run.stderr).toContain('No provider configuration found');
  }, 70_000);
});
