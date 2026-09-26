import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';

async function route(argv: readonly string[]): Promise<{ code: unknown; out: string; err: string }> {
  const scratch = mkdtempSync(join(tmpdir(), 'rs-daemon-route-'));
  const cwd = join(scratch, 'project');
  const previousExitCode = process.exitCode;
  // The supervised inventory lives under HOME; point it at the scratch directory.
  vi.stubEnv('HOME', scratch);
  vi.stubEnv('XDG_RUNTIME_DIR', '');
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    mkdirSync(cwd);
    const handled = await runPreparsedCliCommand(
      {
        providerDefinitions: [],
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', realpathSync(cwd)),
      },
      ['node', 'robota', 'daemon', ...argv],
      cwd,
    );
    expect(handled).toBe(true);
    return {
      code: process.exitCode,
      out: stdout.mock.calls.map(([text]) => String(text)).join('').replaceAll(realpathSync(cwd), '<cwd>'),
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

describe('robota daemon route', () => {
  it('prints usage for an unknown action', async () => {
    const result = await route(['restart']);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^Usage: robota daemon start \[--json\]/u);
  });

  it('reports no daemon for a workspace without one', async () => {
    expect(await route(['status'])).toMatchObject({ code: 0, out: 'No daemon is running in <cwd>.\n' });
    expect(await route(['status', '--json'])).toMatchObject({ code: 0, out: '{"running":false}\n' });
    expect(await route(['stop'])).toMatchObject({ code: 0, out: 'No daemon is running in <cwd>.\n' });
  });

  it('refuses to start a daemon in an untrusted workspace before spawning anything', async () => {
    const result = await route(['start', '--json']);
    expect(result.code).toBe(1);
    expect(result.out).toBe('');
    expect(result.err).toMatch(/trust/i);
  });
});
