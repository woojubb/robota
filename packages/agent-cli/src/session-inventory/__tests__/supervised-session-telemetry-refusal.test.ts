import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { runWorkspaceTrustCommand } from '../../startup/workspace-trust-command.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

vi.mock('../supervised-session-launch.js', () => ({ launchSupervisedSession: vi.fn() }));

describe('supervised session start reports a real telemetry refusal', () => {
  it('fails with the specific refusal message instead of spawning a child that would exit unexplained', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-telemetry-refusal-'));
    const cwd = join(scratch, 'project');
    const home = join(scratch, 'home');
    for (const directory of [cwd, home]) mkdirSync(directory);
    execFileSync('git', ['init', '--quiet', cwd]);
    const previousHome = process.env['HOME'];
    const previousExitCode = process.exitCode;
    process.env['HOME'] = home;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await runWorkspaceTrustCommand(['--yes'], cwd)).toBe(0);
      // Enabled with an OTLP trace export, but missing the required explicit protocol setting:
      // `createConfiguredNodeOtlpLiveTelemetryPort` (and the new parent-side validator) refuse this.
      const invalidTelemetry = Object.freeze({
        ROBOTA_TELEMETRY_ENABLED: '1',
        ROBOTA_TELEMETRY_TRACES: 'otlp',
        ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example',
      });
      const options = { providerDefinitions: [] };
      const handled = await runPreparsedCliCommand(
        options, ['node', 'robota', 'session', 'start', '--background'], cwd, invalidTelemetry,
      );
      expect(handled).toBe(true);
      expect(launchSupervisedSession).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      const messages = stderr.mock.calls.map((call) => String(call[0]));
      expect(messages.some((message) => message.includes('http/protobuf'))).toBe(true);
      expect(messages.some((message) => message.includes('exited before it was ready'))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      process.exitCode = previousExitCode;
      stderr.mockRestore();
      stdout.mockRestore();
      vi.clearAllMocks();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
