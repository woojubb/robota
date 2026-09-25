import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { runWorkspaceTrustCommand } from '../../startup/workspace-trust-command.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';
import { runSessionViewCommand } from '../session-view-command.js';

vi.mock('../session-view-command.js', () => ({ runSessionViewCommand: vi.fn() }));
vi.mock('../supervised-session-launch.js', () => ({ launchSupervisedSession: vi.fn() }));

describe('supervised session view start callback refuses before spawning', () => {
  it('rejects with the specific telemetry refusal message instead of ever spawning the child', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-telemetry-view-refusal-'));
    const cwd = join(scratch, 'project');
    const home = join(scratch, 'home');
    for (const directory of [cwd, home]) mkdirSync(directory);
    execFileSync('git', ['init', '--quiet', cwd]);
    const previousHome = process.env['HOME'];
    const previousExitCode = process.exitCode;
    process.env['HOME'] = home;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Enabled with an OTLP trace export, but missing the required explicit protocol setting:
    // the parent-side validator refuses this before the callback ever reaches `launchSupervisedSession`.
    const invalidTelemetry = Object.freeze({
      ROBOTA_TELEMETRY_ENABLED: '1',
      ROBOTA_TELEMETRY_TRACES: 'otlp',
      ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example',
    });
    vi.mocked(runSessionViewCommand).mockImplementation(async (_argv, options) => {
      await expect(options?.start?.(cwd)).rejects.toThrow('http/protobuf');
      return 0;
    });
    try {
      expect(await runWorkspaceTrustCommand(['--yes'], cwd)).toBe(0);
      const options = { providerDefinitions: [] };
      expect(await runPreparsedCliCommand(
        options, ['node', 'robota', 'session', 'view'], cwd, invalidTelemetry,
      )).toBe(true);
      expect(launchSupervisedSession).not.toHaveBeenCalled();
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      process.exitCode = previousExitCode;
      stdout.mockRestore();
      vi.clearAllMocks();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
