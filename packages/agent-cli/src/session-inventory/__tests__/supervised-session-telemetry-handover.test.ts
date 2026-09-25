import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { runWorkspaceTrustCommand } from '../../startup/workspace-trust-command.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';
import { runSessionViewCommand } from '../session-view-command.js';

vi.mock('../session-view-command.js', () => ({ runSessionViewCommand: vi.fn() }));
vi.mock('../supervised-session-launch.js', () => ({ launchSupervisedSession: vi.fn() }));

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
// A validly resolvable configuration: the parent now validates it (without starting an exporter)
// before spawning the child, the same way the child validates it when it starts.
const snapshot = Object.freeze({
  ROBOTA_TELEMETRY_ENABLED: '1',
  ROBOTA_TELEMETRY_TRACES: 'otlp',
  ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
  ROBOTA_TELEMETRY_OTLP_ENDPOINT: 'https://collector.example',
  ROBOTA_TELEMETRY_OTLP_HEADERS: 'authorization=Bearer%20handover-sentinel',
});

describe('supervised session telemetry handover', () => {
  it('hands the removed telemetry settings only to the supervised runtime it launches', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-telemetry-handover-'));
    const cwd = join(scratch, 'project');
    const home = join(scratch, 'home');
    for (const directory of [cwd, home]) mkdirSync(directory);
    execFileSync('git', ['init', '--quiet', cwd]);
    const previousHome = process.env['HOME'];
    const previousExitCode = process.exitCode;
    process.env['HOME'] = home;
    process.env['RS_HANDOVER_MARKER'] = 'kept';
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(launchSupervisedSession).mockResolvedValue(ID);
    vi.mocked(runSessionViewCommand).mockImplementation(async (_argv, options) => {
      await expect(options?.start?.(cwd)).resolves.toBe(ID);
      return 0;
    });
    try {
      expect(await runWorkspaceTrustCommand(['--yes'], cwd)).toBe(0);
      const options = {
        providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
      };
      expect(await runPreparsedCliCommand(options, ['node', 'robota', 'session', 'view'], cwd, snapshot)).toBe(true);
      expect(await runPreparsedCliCommand({ providerDefinitions: [] },
        ['node', 'robota', 'session', 'start', '--background', '--name', 'Morning'], cwd, snapshot)).toBe(true);
      expect(launchSupervisedSession).toHaveBeenCalledTimes(2);
      for (const [target, launchOptions] of vi.mocked(launchSupervisedSession).mock.calls) {
        expect(target).toBe(cwd);
        expect(launchOptions?.env).toMatchObject({ ...snapshot, RS_HANDOVER_MARKER: 'kept', HOME: home });
      }
      expect(vi.mocked(launchSupervisedSession).mock.calls[1]?.[1]?.name).toBe('Morning');
      expect(process.env['ROBOTA_TELEMETRY_OTLP_HEADERS']).toBeUndefined();
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      delete process.env['RS_HANDOVER_MARKER'];
      process.exitCode = previousExitCode;
      stdout.mockRestore();
      vi.clearAllMocks();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
