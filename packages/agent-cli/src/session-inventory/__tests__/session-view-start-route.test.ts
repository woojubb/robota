import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import {
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
  type renderAttachedApp,
} from '@robota-sdk/agent-ui-terminal';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { createThemeSurface } from '../../startup/theme-surface.js';
import { runWorkspaceTrustCommand } from '../../startup/workspace-trust-command.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';
import { runSessionViewCommand, type ISessionViewCommandOptions } from '../session-view-command.js';

vi.mock('../session-view-command.js', () => ({ runSessionViewCommand: vi.fn() }));
vi.mock('../supervised-session-launch.js', () => ({ launchSupervisedSession: vi.fn() }));

describe('session view background start route', () => {
  it('rechecks trust for the selected directory instead of borrowing the viewer workspace grant', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-view-route-'));
    const cwd = join(scratch, 'viewer');
    const other = join(scratch, 'other');
    const home = join(scratch, 'home');
    for (const directory of [cwd, other, home]) mkdirSync(directory);
    execFileSync('git', ['init', '--quiet', cwd]);
    execFileSync('git', ['init', '--quiet', other]);
    const previousHome = process.env['HOME'];
    const previousExitCode = process.exitCode;
    process.env['HOME'] = home;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.mocked(launchSupervisedSession).mockResolvedValue('8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4');
    const renderer = vi.fn(async () => undefined);
    vi.mocked(runSessionViewCommand).mockImplementation(async (_argv, options) => {
      expect(options?.launchCwd).toBe(cwd);
      expect(options?.render).toBe(renderer);
      await expect(options?.start?.(other)).rejects.toThrow(/Workspace trust is required/);
      expect(launchSupervisedSession).not.toHaveBeenCalled();
      await expect(options?.start?.(cwd)).resolves.toBe('8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4');
      expect(launchSupervisedSession).toHaveBeenCalledExactlyOnceWith(cwd, {
        env: expect.any(Object),
      });
      expect(await runWorkspaceTrustCommand(['revoke', '--yes'], cwd)).toBe(1);
      await expect(options?.start?.(cwd)).rejects.toThrow(/Workspace trust is required/);
      expect(launchSupervisedSession).toHaveBeenCalledTimes(1);
      return 0;
    });
    try {
      expect(await runWorkspaceTrustCommand(['--yes'], cwd)).toBe(0);
      expect(
        await runPreparsedCliCommand(
          {
            providerDefinitions: [],
            projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
          },
          ['node', 'robota', 'session', 'view'],
          cwd,
          {},
          renderer,
        ),
      ).toBe(true);
      expect(process.exitCode).toBe(0);
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      process.exitCode = previousExitCode;
      stdout.mockRestore();
      vi.clearAllMocks();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('attaches with the same full terminal UI as robota --attach and robota session attach', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rs-view-route-app-'));
    // The renderer reads this user's settings, keybindings and themes: a home of the test's own.
    vi.stubEnv('HOME', cwd);
    const previousExitCode = process.exitCode;
    const renderStub = vi.fn<typeof renderAttachedApp>(async () => 'user');
    let renderAttached: ISessionViewCommandOptions['renderAttached'];
    vi.mocked(runSessionViewCommand).mockImplementation(async (_argv, options) => {
      renderAttached = options?.renderAttached;
      return 0;
    });
    try {
      expect(
        await runPreparsedCliCommand(
          { providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd) },
          ['node', 'robota', 'session', 'view'],
          cwd,
          {},
          vi.fn(),
          {
            renderAttachedApp: renderStub,
            createThemeSurface,
            createNodeKeybindingsSource,
            createDefaultTuiCliAdapter,
            installTuiProcessGuards: vi.fn(),
          },
        ),
      ).toBe(true);
      expect(renderAttached).toBeTypeOf('function');
      const connection = { send: vi.fn(), subscribe: () => () => undefined, onClose: () => () => undefined };
      await renderAttached?.({
        connection, driverId: 'attach:1', mode: 'observe', sessionLabel: 'Morning review',
        screenReaderFlag: undefined, announce: false,
      });
      expect(renderStub).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        connection, driverId: 'attach:1', mode: 'observe', sessionLabel: 'Morning review', announce: false,
      }));
    } finally {
      vi.unstubAllEnvs();
      process.exitCode = previousExitCode;
      vi.clearAllMocks();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
