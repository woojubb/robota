/**
 * Resuming a session another process has open, through the real CLI (print mode over the scripted
 * provider): `-r <id>` and `-c` are refused with the store's own words, which name the process that
 * holds the session and the command that releases a marker whose process ended, and they start
 * nothing over it. Once that process lets go, the same resume runs.
 *
 * The workspace is trusted, so the sessions live in the project's store on Linux and in the user's
 * store elsewhere (project writes are Linux-only); the CLI composes whichever applies.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProcessMarkers,
  readCurrentProcessIdentity,
  readProcessStartTime,
} from '@robota-sdk/agent-core/node';
import { createScriptedProvider, leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';
import { createTestProductRuntime } from '../helpers/product-runtime.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';

import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-held-resume-')));
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;
const HELD_ID = 'session_held_elsewhere';

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

async function run(
  project: string,
  argv: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  process.argv = ['node', 'test-product', ...argv];
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as never);
  let exitCode = -1;
  try {
    await startCli({
      productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      providerDefinitions: [
        scriptedDefinition(createScriptedProvider([{ text: 'RESUMED_REPLY' }])),
      ],
      projectAccess: await createTrustedWorkspaceProjectAccess(project),
    });
    throw new Error('startCli returned without process.exit');
  } catch (error) {
    const match = /^process\.exit:(\d+)$/.exec(
      error instanceof Error ? error.message : String(error),
    );
    if (!match) throw error;
    exitCode = Number(match[1]);
  } finally {
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
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

  it('-c is refused the same way for the latest session, and both run once the process lets go', async () => {
    const refused = await run(project, ['-p', 'hi', '-c']);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`Session ${HELD_ID} is open in another process`);

    createProcessMarkers(join(sessionsDirectory, 'claims')).remove(HELD_ID, { force: true });
    const resumed = await run(project, ['-p', 'hi', '-r', HELD_ID]);

    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain('RESUMED_REPLY');
  });
});
