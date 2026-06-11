/**
 * Exit-code contract tests (CLI-064).
 *
 * Print mode must exit 3 on provider configuration errors (typed
 * ProviderConfigError) so automation can distinguish "reconfigure, do not
 * retry" from runtime failures (exit 1). Non-print startup keeps exit 1.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../cli.js';

const TMP_BASE = join(tmpdir(), `robota-cli-exit-codes-test-${process.pid}`);
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

describe('provider config error exit codes (CLI-064)', () => {
  let project: string;

  beforeEach(() => {
    project = join(TMP_BASE, `project-${Math.random().toString(36).slice(2)}`);
    mkdirSync(project, { recursive: true });
    process.env.HOME = join(TMP_BASE, 'home');
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('TC-03: print mode with no provider configuration exits 3 with guidance on stderr', async () => {
    process.argv = ['node', 'robota', '-p', 'say hi'];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(startCli()).rejects.toThrow('process.exit:3');

    expect(stderr.mock.calls.join('')).toContain('No provider configuration found');
  });

  it('TC-03: non-print startup with no provider configuration keeps exit 1', async () => {
    process.argv = ['node', 'robota'];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(startCli()).rejects.toThrow('process.exit:1');

    expect(stderr.mock.calls.join('')).toContain('No provider configuration found');
  });
});
