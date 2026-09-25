import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildWorkspaceMoveArgv, parseCliArgs } from '../../utils/cli-args.js';
import { resolveStartupWorkspaceProjectAccess } from '../workspace-project-composition.js';
import { createWorkspaceMoveAdapter } from '../workspace-move-adapter.js';

import type { IWorkspaceMoveRequest } from '@robota-sdk/agent-framework';

/** Issue #3081 — `/cd` in the TUI: save the conversation for the target, then run robota there. */
describe('buildWorkspaceMoveArgv', () => {
  it('keeps this run\'s flags and drops what to resume and what to run', () => {
    expect(
      buildWorkspaceMoveArgv(
        ['--model', 'm1', '-c', '--permission-mode', 'acceptEdits', 'hello world', '--fork-session'],
        { resumeId: 's2', movedFrom: '/w/a', restricted: false },
      ),
    ).toEqual([
      '--model=m1',
      '--permission-mode=acceptEdits',
      '--resume',
      's2',
      '--moved-from',
      '/w/a',
    ]);
  });

  it('keeps a value that begins with - attached to its flag', () => {
    const argv = buildWorkspaceMoveArgv(['--append-system-prompt=-be terse'], {
      resumeId: 's2',
      movedFrom: '/w/a',
      restricted: false,
    });
    expect(argv[0]).toBe('--append-system-prompt=-be terse');
    // The target run parses what the move produced.
    expect(() => parseCliArgs(argv)).not.toThrow();
  });

  it('drops the name, task file and replay log of this run', () => {
    expect(
      buildWorkspaceMoveArgv(['--name', 'x', '--task-file', './t.md', '--session-log', './l'], {
        resumeId: 's2',
        movedFrom: '/w/a',
        restricted: false,
      }),
    ).toEqual(['--resume', 's2', '--moved-from', '/w/a']);
  });

  it('replaces an earlier move and resume, and carries a restriction', () => {
    expect(
      buildWorkspaceMoveArgv(['-r', 'old', '--moved-from', '/w/0', '--restricted-workspace'], {
        resumeId: 's3',
        movedFrom: '/w/a',
        restricted: true,
      }),
    ).toEqual(['--resume', 's3', '--moved-from', '/w/a', '--restricted-workspace']);
  });
});

describe('createWorkspaceMoveAdapter', () => {
  let home: string;
  let target: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-cd-home-')));
    target = join(home, 'target');
    mkdirSync(target);
    vi.stubEnv('HOME', home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  function request(restricted: boolean): IWorkspaceMoveRequest {
    return {
      fromCwd: '/w/a',
      targetCwd: target,
      restricted,
      record: {
        id: 'moved-1',
        name: 'work',
        cwd: target,
        createdAt: '2026-09-25T00:00:00.000Z',
        updatedAt: '2026-09-25T00:00:00.000Z',
        messages: [],
        history: [],
        systemPrompt: 'SYSTEM PROMPT',
        toolSchemas: [],
      },
    };
  }

  it('saves the copy where the target session will look, then ends the TUI and reruns there', async () => {
    let exitListener: (() => void) | undefined;
    const requestExit = vi.fn();
    const runSync = vi.fn().mockReturnValue({ status: 7 });
    const resolveAccess = vi.fn();
    const adapter = createWorkspaceMoveAdapter({
      userHome: home,
      argv: ['--model', 'm1'],
      requestExit,
      environment: { ROBOTA_TELEMETRY_ENDPOINT: 'http://collector' },
      resolveAccess,
      onProcessExit: (listener) => {
        exitListener = listener;
      },
      runSync: runSync as never,
    });

    await adapter.move(request(true));

    // A Restricted session stays Restricted: the target's own trust is not even consulted.
    expect(resolveAccess).not.toHaveBeenCalled();
    const sessions = readdirSync(home, { recursive: true }).map(String);
    expect(sessions.some((path) => path.includes('moved-1'))).toBe(true);
    expect(requestExit).toHaveBeenCalledOnce();
    expect(runSync).not.toHaveBeenCalled();

    const previousExitCode = process.exitCode;
    exitListener!();
    const [, args, options] = runSync.mock.calls[0]!;
    expect(args).toEqual(
      expect.arrayContaining(['--model=m1', '--resume', 'moved-1', '--moved-from', '/w/a']),
    );
    expect(args).toContain('--restricted-workspace');
    expect(options).toEqual(expect.objectContaining({ cwd: target, stdio: 'inherit' }));
    // Telemetry startup took out of process.env is handed to the target run.
    expect((options as { env: Record<string, string> }).env['ROBOTA_TELEMETRY_ENDPOINT']).toBe(
      'http://collector',
    );
    expect(process.exitCode).toBe(7);
    process.exitCode = previousExitCode;
  });

  it('asks the trust store about the target when the session is trusted', async () => {
    const resolveAccess = vi.fn().mockResolvedValue({
      status: 'restricted',
      reason: 'WorkspaceAuthorityRequired',
      trustState: 'untrusted',
    });
    const adapter = createWorkspaceMoveAdapter({
      userHome: home,
      argv: [],
      requestExit: vi.fn(),
      resolveAccess,
      onProcessExit: () => undefined,
      runSync: vi.fn() as never,
    });
    await adapter.move(request(false));
    expect(resolveAccess).toHaveBeenCalledWith(target);
    expect(existsSync(target)).toBe(true);
  });
});

describe('a /cd target never widens access (issue #3081)', () => {
  it('starts restricted under the flag, whatever access the directory would get', async () => {
    const trusted = { status: 'trusted' } as never;
    const access = await resolveStartupWorkspaceProjectAccess(
      ['node', 'robota', '--restricted-workspace'],
      '/w/b',
      { projectAccess: trusted },
    );
    expect(access.status).toBe('restricted');
    const without = await resolveStartupWorkspaceProjectAccess(['node', 'robota'], '/w/b', {
      projectAccess: trusted,
    });
    expect(without).toBe(trusted);
  });
});
