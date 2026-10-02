import { createInventoryRuntime as createTestProductRuntime } from './product-runtime.js';
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
        productRuntime: expect.any(Object),
      });
      expect(await runWorkspaceTrustCommand(['revoke', '--yes'], cwd, createTestProductRuntime())).toBe(0);
      await expect(options?.start?.(cwd)).rejects.toThrow(/Workspace trust is required/);
      expect(launchSupervisedSession).toHaveBeenCalledTimes(1);
      return 0;
    });
    try {
      expect(await runWorkspaceTrustCommand(['--yes'], cwd, createTestProductRuntime())).toBe(0);
      expect(
        await runPreparsedCliCommand(
          { productRuntime: createTestProductRuntime(),
            providerDefinitions: [],
            projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
          },
          ['node', 'test-product', 'session', 'view'],
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

  it('asks about a folder not trusted yet, then starts it Trusted or Restricted as answered (#3268)', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-view-route-trust-'));
    const cwd = join(scratch, 'viewer');
    const home = join(scratch, 'home');
    for (const directory of [cwd, home]) mkdirSync(directory);
    execFileSync('git', ['init', '--quiet', cwd]);
    vi.stubEnv('HOME', home);
    const previousExitCode = process.exitCode;
    vi.mocked(launchSupervisedSession).mockResolvedValue('8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4');
    vi.mocked(runSessionViewCommand).mockImplementation(async (_argv, options) => {
      // The question names the folder and what trust would load. #3282 §3: a row appears only when
      // its state is known — only Linux's pinned handle-walk can tell a not-yet-created
      // `.test-product/settings.json` apart from one it cannot describe safely, so elsewhere `loads`
      // reports none of the candidate paths before trust.
      await expect(options?.startTrustQuestion?.(cwd)).resolves.toMatchObject({
        folder: expect.any(String),
        loads:
          process.platform === 'linux'
            ? expect.arrayContaining([expect.stringContaining('.test-product/settings.json')])
            : [],
      });
      // Without an answer an untrusted folder is still refused.
      await expect(options?.start?.(cwd)).rejects.toThrow(/Workspace trust is required/);
      // Restricted: started without a grant, and told to stay Restricted.
      await options?.start?.(cwd, 'restricted');
      expect(launchSupervisedSession).toHaveBeenLastCalledWith(cwd, {
        env: expect.any(Object),
        productRuntime: expect.any(Object),
        restricted: true,
      });
      await expect(options?.startTrustQuestion?.(cwd)).resolves.toBeDefined();
      // Trust: the grant is recorded, and the session starts Trusted.
      await options?.start?.(cwd, 'trust');
      expect(launchSupervisedSession).toHaveBeenLastCalledWith(cwd, { env: expect.any(Object), productRuntime: expect.any(Object) });
      await expect(options?.startTrustQuestion?.(cwd)).resolves.toBeUndefined();
      // A Restricted answer holds though the folder is trusted now: it never widens.
      await options?.start?.(cwd, 'restricted');
      expect(launchSupervisedSession).toHaveBeenLastCalledWith(cwd, {
        env: expect.any(Object),
        productRuntime: expect.any(Object),
        restricted: true,
      });
      return 0;
    });
    try {
      expect(
        await runPreparsedCliCommand(
          { productRuntime: createTestProductRuntime(),
            providerDefinitions: [],
            projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
          },
          ['node', 'test-product', 'session', 'view'],
          cwd,
          {},
          vi.fn(async () => undefined),
        ),
      ).toBe(true);
      expect(process.exitCode).toBe(0);
      expect(launchSupervisedSession).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllEnvs();
      process.exitCode = previousExitCode;
      vi.clearAllMocks();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('attaches with the same full terminal UI as test-product --attach and test-product session attach', async () => {
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
          { productRuntime: createTestProductRuntime(),
            providerDefinitions: [],
            projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
          },
          ['node', 'test-product', 'session', 'view'],
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
      const connection = {
        send: vi.fn(),
        subscribe: () => () => undefined,
        onClose: () => () => undefined,
      };
      await renderAttached?.({
        connection,
        driverId: 'attach:1',
        mode: 'observe',
        sessionLabel: 'Morning review',
        screenReaderFlag: undefined,
        announce: false,
      });
      expect(renderStub).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          connection,
          driverId: 'attach:1',
          mode: 'observe',
          sessionLabel: 'Morning review',
          announce: false,
        }),
      );
    } finally {
      vi.unstubAllEnvs();
      process.exitCode = previousExitCode;
      vi.clearAllMocks();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('starts a background session Restricted when asked with --restricted-workspace, as the refusal suggests', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-start-restricted-'));
    const cwd = join(scratch, 'project');
    const home = join(scratch, 'home');
    for (const directory of [cwd, home]) mkdirSync(directory);
    execFileSync('git', ['init', '--quiet', cwd]);
    vi.stubEnv('HOME', home);
    const previousExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.mocked(launchSupervisedSession).mockResolvedValue('8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4');
    const start = (...extra: string[]) =>
      runPreparsedCliCommand(
        { productRuntime: createTestProductRuntime(), providerDefinitions: [] },
        ['node', 'test-product', 'session', 'start', '--background', ...extra],
        cwd,
      );
    try {
      // Untrusted and not asked for Restricted: refused, naming both ways past.
      process.exitCode = undefined;
      await start();
      expect(process.exitCode).toBe(1);
      expect(stderr.mock.calls.flat().join('')).toContain('--restricted-workspace');
      expect(launchSupervisedSession).not.toHaveBeenCalled();

      // The suggested flag is accepted, and the session is told to stay Restricted.
      process.exitCode = undefined;
      await start('--restricted-workspace', '--name', 'review');
      expect(process.exitCode).toBeUndefined();
      expect(launchSupervisedSession).toHaveBeenCalledExactlyOnceWith(cwd, {
        env: expect.any(Object),
        productRuntime: expect.any(Object),
        name: 'review',
        restricted: true,
      });
    } finally {
      vi.unstubAllEnvs();
      process.exitCode = previousExitCode;
      stdout.mockRestore();
      stderr.mockRestore();
      vi.clearAllMocks();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
