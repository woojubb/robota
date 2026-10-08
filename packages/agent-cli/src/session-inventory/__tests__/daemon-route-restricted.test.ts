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
vi.mock('../supervised-session-control.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../supervised-session-control.js')>(),
  listSupervisedSessions: vi.fn(async () => []),
  connectSupervisedDaemon: vi.fn(async () => 'ws://127.0.0.1:43127'),
}));

import { launchSupervisedSession } from '../supervised-session-launch.js';
import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';

async function route(
  argv: readonly string[],
  command = 'daemon',
  options: { readonly git?: boolean; readonly launchSucceeds?: boolean } = {},
): Promise<{ code: unknown; err: string; out: string }> {
  vi.mocked(launchSupervisedSession).mockReset();
  if (options.launchSucceeds) vi.mocked(launchSupervisedSession).mockResolvedValue('synthetic-session');
  else vi.mocked(launchSupervisedSession).mockRejectedValue(new Error('launch reached'));
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rs-daemon-restricted-')));
  const cwd = join(scratch, 'project');
  const previousExitCode = process.exitCode;
  vi.stubEnv('HOME', scratch);
  vi.stubEnv('XDG_RUNTIME_DIR', '');
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    mkdirSync(cwd);
    if (options.git !== false) execFileSync('git', ['init', '--quiet', cwd]);
    await runPreparsedCliCommand(
      { productRuntime: createTestProductRuntime(), providerDefinitions: [] },
      ['node', 'test-product', command, ...argv],
      cwd,
    );
    return {
      code: process.exitCode,
      err: stderr.mock.calls.map(([text]) => String(text)).join(''),
      out: stdout.mock.calls.map(([text]) => String(text)).join(''),
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
  it('reports ignored project settings for a plain new daemon outside Git', async () => {
    const result = await route(['start', '--json'], 'daemon', { git: false, launchSucceeds: true });
    expect(result.code).toBe(0);
    expect(result.out).toContain('"id":"synthetic-session"');
    expect(result.err).toContain('Restricted workspace mode');
    expect(result.err).toContain('.test-product/settings.json');
    expect(launchSupervisedSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ restricted: true }),
    );
  });

  it('reports ignored project settings for a plain background session outside Git', async () => {
    const result = await route(['start', '--background'], 'session', { git: false, launchSucceeds: true });
    expect(result.code).not.toBe(1);
    expect(result.out).toContain('Supervised session: synthetic-session');
    expect(result.err).toContain('Restricted workspace mode');
    expect(result.err).toContain('.test-product/settings.json');
    expect(launchSupervisedSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ restricted: true }),
    );
  });
  it.each(['session'])('reports ignored project settings before a Restricted %s launch', async (command) => {
    const flags = command === 'daemon' ? ['--json'] : ['--background'];
    const result = await route(['start', ...flags, '--restricted-workspace'], command);
    expect(result.err).toContain('Restricted workspace mode');
    expect(result.err).toContain('.test-product/settings.json');
    expect(result.err).toContain('.claude/settings.local.json');
  });

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
