import { createInventoryRuntime as createTestProductRuntime } from './product-runtime.js';
/**
 * Issue #3268: a daemon a person chose to start Restricted (the desktop app asked them) passes the
 * trust admission and is launched Restricted; without that choice an untrusted workspace is refused.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../supervised-session-launch.js', () => ({
  launchSupervisedSession: vi.fn(async () => {
    throw new Error('launch reached');
  }),
}));

import { launchSupervisedSession } from '../supervised-session-launch.js';
import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';

async function route(argv: readonly string[]): Promise<{ code: unknown; err: string }> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rs-daemon-restricted-')));
  const cwd = join(scratch, 'project');
  const previousExitCode = process.exitCode;
  vi.stubEnv('HOME', scratch);
  vi.stubEnv('XDG_RUNTIME_DIR', '');
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    mkdirSync(cwd);
    execFileSync('git', ['init', '--quiet', cwd]);
    await runPreparsedCliCommand(
      { productRuntime: createTestProductRuntime(), providerDefinitions: [] },
      ['node', 'test-product', 'daemon', ...argv],
      cwd,
    );
    return {
      code: process.exitCode,
      err: stderr.mock.calls.map(([text]) => String(text)).join(''),
    };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.unstubAllEnvs();
    process.exitCode = previousExitCode;
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('test-product daemon start in an untrusted workspace', () => {
  it('is refused before anything is launched', async () => {
    const result = await route(['start', '--json']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('Workspace trust is required');
    expect(launchSupervisedSession).not.toHaveBeenCalled();
  });

  it('is admitted and launched Restricted when a person chose Restricted', async () => {
    const result = await route(['start', '--json', '--restricted-workspace']);
    expect(result.err).not.toContain('Workspace trust is required');
    expect(launchSupervisedSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ daemon: true, restricted: true }),
    );
  });
});
