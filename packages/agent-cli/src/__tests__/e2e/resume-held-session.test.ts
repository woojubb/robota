/**
 * Resuming a session another process has open, through the real CLI (print mode over the scripted
 * provider, and the real terminal UI): `-r <id>` and `-c` are refused with the store's own words,
 * which name the process that holds the session and the command that releases a marker whose process
 * ended, and they start nothing over it. Once that process lets go, the same resume runs. The
 * terminal UI builds its session in its first render, where a refusal must end the run with those
 * words, not with Ink's error screen.
 *
 * The workspace is trusted, so the sessions live in the project's store on Linux and in the user's
 * store elsewhere (project writes are Linux-only); the CLI composes whichever applies.
 */

import { createProcessOperationLock } from '@robota-sdk/agent-session/node';

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProcessMarkers,
  readCurrentProcessIdentity,
  readProcessStartTime,
} from '@robota-sdk/agent-core/node';
import { createScriptedProvider, leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework/node';
import {
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
  renderApp,
} from '@robota-sdk/agent-ui-terminal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';
import { startCliCore } from '../../cli-core.js';
import { createThemeSurface } from '../../startup/theme-surface.js';
import { createTestProductRuntime } from '../helpers/product-runtime.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';

import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-held-resume-')));
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;
const HELD_ID = 'session_held_elsewhere';
const testHost = createTestFrameworkHost();

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

/** The real terminal UI, with the parts that would take over this process replaced by spies. */
function terminalUi() {
  return {
    createThemeSurface,
    createNodeKeybindingsSource,
    createDefaultTuiCliAdapter,
    renderApp,
    renderSupervisedSessionView: vi.fn(),
    renderAttachedApp: vi.fn(),
    installTuiProcessGuards: vi.fn(),
    setLiveChannel: vi.fn(),
  };
}

async function run(
  project: string,
  argv: string[],
  presentation?: ReturnType<typeof terminalUi>,
): Promise<{ exitCode: number; stdout: string; stderr: string; failure: Error | undefined }> {
  process.argv = ['node', 'test-product', ...argv];
  const stdout: string[] = [];
  const stderr: string[] = [];
  // The terminal UI waits for each frame's write to complete.
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    stdout.push(String(chunk));
    for (const argument of rest) if (typeof argument === 'function') argument();
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as never);
  let exitCode = -1;
  let failure: Error | undefined;
  try {
    const options = {
      productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      providerDefinitions: [
        scriptedDefinition(createScriptedProvider([{ text: 'RESUMED_REPLY' }])),
      ],
      projectAccess: await createTrustedWorkspaceProjectAccess(project),
    };
    if (presentation === undefined) await startCli(options);
    else await startCliCore(options, testHost, () => [], presentation as never);
    throw new Error('startCli returned without process.exit');
  } catch (error) {
    const match = /^process\.exit:(\d+)$/.exec(
      error instanceof Error ? error.message : String(error),
    );
    // A run that fails before it exits is the entry's to report: it says the message and exits 1.
    if (match) exitCode = Number(match[1]);
    else if (presentation !== undefined && error instanceof Error) failure = error;
    else throw error;
  } finally {
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join(''), failure };
}

/** A live process other than this one: the one that started this test worker. */
function liveOther() {
  const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
  const startTime = readProcessStartTime(process.ppid);
  return { ...here, pid: process.ppid, ...(startTime === undefined ? {} : { startTime }) };
}

describe('resuming a session another process has open', () => {
  let project: string;
  let sessionsDirectory: string;
  let before: string;

  beforeEach(() => {
    project = join(TMP_BASE, `project-${Math.random().toString(36).slice(2)}`);
    const home = join(TMP_BASE, 'home');
    mkdirSync(join(project, '.test-product'), { recursive: true });
    writeFileSync(
      join(project, '.test-product', 'settings.json'),
      JSON.stringify({
        currentProvider: 'scripted',
        providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
      }),
      'utf8',
    );
    process.env.HOME = home;
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    sessionsDirectory =
      process.platform === 'linux'
        ? join(project, '.test-product', 'sessions')
        : join(home, '.test-product', 'sessions');
    createNodeHostSessionStore(sessionsDirectory, { sealing: 'plain' }).save({
      id: HELD_ID,
      cwd: project,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      messages: [],
    });
    before = readFileSync(join(sessionsDirectory, `${HELD_ID}.json`), 'utf8');
    leaveProcessMarker(join(sessionsDirectory, 'claims'), HELD_ID, liveOther());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('-r <id> is refused in the store’s words, naming the process and the release command', async () => {
    const result = await run(project, ['-p', 'hi', '-r', HELD_ID]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Session ${HELD_ID} is open in another process (pid ${process.ppid}`,
    );
    expect(result.stderr).toContain(`test-product session release ${HELD_ID} --force`);
    expect(result.stdout).not.toContain('RESUMED_REPLY');
    expect(readFileSync(join(sessionsDirectory, `${HELD_ID}.json`), 'utf8')).toBe(before);
  });

  it.each([
    ['-r <id>', ['-r', HELD_ID]],
    ['-c', ['-c']],
  ])(
    'the terminal UI under %s ends with the store’s words, with no error screen, and starts nothing',
    async (_flag, argv) => {
      const ui = terminalUi();

      const result = await run(project, argv, ui);

      expect(result.failure?.message).toContain(
        `Session ${HELD_ID} is open in another process (pid ${process.ppid}`,
      );
      expect(result.failure?.message).toContain(`test-product session release ${HELD_ID} --force`);
      expect(result.exitCode).toBe(-1);
      expect(result.stdout).not.toContain('ERROR');
      expect(result.stdout).not.toMatch(/\.tsx?:\d+/);
      expect(ui.setLiveChannel).not.toHaveBeenCalled();
      expect(readFileSync(join(sessionsDirectory, `${HELD_ID}.json`), 'utf8')).toBe(before);
    },
  );

  it('-c is refused the same way for the latest session, and both run once the process lets go', async () => {
    const refused = await run(project, ['-p', 'hi', '-c']);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`Session ${HELD_ID} is open in another process`);

    createProcessMarkers(join(sessionsDirectory, 'claims'), {
      operationLock: createProcessOperationLock(join(sessionsDirectory, 'claims')),
    }).remove(HELD_ID, { force: true });
    const resumed = await run(project, ['-p', 'hi', '-r', HELD_ID]);

    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain('RESUMED_REPLY');
  });
});
