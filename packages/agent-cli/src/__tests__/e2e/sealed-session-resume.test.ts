/**
 * Resuming a sealed session through the real CLI (print mode over the scripted provider), which
 * seals nothing yet and so holds no keys that open it: `-r <id>` says it is sealed instead of
 * "Session not found", `-c` says sealed sessions exist instead of quietly starting fresh, neither
 * tells anyone to unlock (no unlock in this process would open it), and neither touches the file.
 *
 * The workspace is trusted, so the sessions live in the project's store on Linux and in the user's
 * store elsewhere (project writes are Linux-only); the CLI composes whichever applies.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import {
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
} from '@robota-sdk/agent-ui-terminal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';
import { startCliCore } from '../../cli-core.js';
import { createThemeSurface } from '../../startup/theme-surface.js';
import { createTestProductRuntime } from '../helpers/product-runtime.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const testHost = createTestFrameworkHost();

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-sealed-resume-')));
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;
const LOCKED_ID = 'session_sealed_locked';

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

/** The terminal UI's entry points, with the parts that would take over this process replaced by spies. */
function spiedPresentation() {
  return {
    createThemeSurface,
    createNodeKeybindingsSource,
    createDefaultTuiCliAdapter,
    renderApp: vi.fn(() => {
      throw new Error('the terminal UI was mounted');
    }),
    renderSupervisedSessionView: vi.fn(),
    renderAttachedApp: vi.fn(),
    installTuiProcessGuards: vi.fn(),
    setLiveChannel: vi.fn(),
  };
}

async function run(
  project: string,
  argv: string[],
  presentation?: ReturnType<typeof spiedPresentation>,
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
    const options = {
      productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      providerDefinitions: [scriptedDefinition(createScriptedProvider([{ text: 'FRESH_REPLY' }]))],
      projectAccess: await createTrustedWorkspaceProjectAccess(project),
    };
    if (presentation === undefined) await startCli(options);
    else await startCliCore(options, testHost, () => [], presentation as never);
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

describe('resuming a sealed session this process holds no keys for', () => {
  let project: string;
  let home: string;
  let sessionsDirectory: string;
  let sealedBefore: Buffer;

  beforeEach(() => {
    project = join(TMP_BASE, `project-${Math.random().toString(36).slice(2)}`);
    home = join(TMP_BASE, 'home');
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
    createNodeHostSessionStore(sessionsDirectory, {
      sealing: { sealer: createTestArtifactSealer() },
    }).save({
      id: LOCKED_ID,
      cwd: project,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      messages: [],
    });
    sealedBefore = readFileSync(join(sessionsDirectory, `${LOCKED_ID}.json`));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('-r <id> says the session is sealed with keys this process does not have, and starts nothing', async () => {
    const result = await run(project, ['-p', 'hi', '-r', LOCKED_ID]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Session ${LOCKED_ID} is sealed with keys this process does not have.\n`,
    );
    expect(result.stderr).not.toMatch(/unlock/i);
    expect(result.stderr).not.toContain('not found');
    expect(readFileSync(join(sessionsDirectory, `${LOCKED_ID}.json`)).equals(sealedBefore)).toBe(
      true,
    );
    // Its claim's writer marker went with the refused resume; the claims directory is left empty.
    expect(readdirSync(sessionsDirectory).filter((name) => name !== 'claims')).toEqual([
      `${LOCKED_ID}.json`,
    ]);
    expect(readdirSync(join(sessionsDirectory, 'claims'))).toEqual([]);
  });

  it('-r <id> still says not found for an id that is not there, when no session is locked', async () => {
    rmSync(join(sessionsDirectory, `${LOCKED_ID}.json`));
    const result = await run(project, ['-p', 'hi', '-r', 'session_nothing']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Session not found: session_nothing\n');
    expect(result.stderr).not.toContain('sealed');
  });

  it('-c says sealed sessions are there, starts a new session, and leaves the sealed file alone', async () => {
    const result = await run(project, ['-p', 'hi', '-c']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('FRESH_REPLY');
    expect(result.stderr).toContain(
      '1 saved session is sealed with keys this process does not have.',
    );
    expect(readFileSync(join(sessionsDirectory, `${LOCKED_ID}.json`)).equals(sealedBefore)).toBe(
      true,
    );
    const files = readdirSync(sessionsDirectory).filter((file) => file.endsWith('.json'));
    expect(files).toHaveLength(2);
    expect(files).toContain(`${LOCKED_ID}.json`);
  });

  it('-r <id> of a damaged record refuses to resume it rather than start empty over it', async () => {
    writeFileSync(join(sessionsDirectory, 'session_damaged.json'), '{ not json', 'utf8');

    const result = await run(project, ['-p', 'hi', '-r', 'session_damaged']);

    expect(result.stdout).not.toContain('FRESH_REPLY');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'Cannot resume session session_damaged: the session store reported "corrupt" for its record.',
    );
    expect(readFileSync(join(sessionsDirectory, 'session_damaged.json'), 'utf8')).toBe(
      '{ not json',
    );
  });

  it('-c says sealed sessions are there even when it continues a readable one', async () => {
    createNodeHostSessionStore(sessionsDirectory, { sealing: 'plain' }).save({
      id: 'session_readable',
      cwd: project,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      messages: [],
    });

    const result = await run(project, ['-p', 'hi', '-c']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('FRESH_REPLY');
    expect(result.stderr).toContain(
      '1 saved session is sealed with keys this process does not have.',
    );
    expect(readFileSync(join(sessionsDirectory, `${LOCKED_ID}.json`)).equals(sealedBefore)).toBe(
      true,
    );
    // It continued the readable session rather than starting another.
    expect(
      readdirSync(sessionsDirectory)
        .filter((file) => file.endsWith('.json'))
        .sort(),
    ).toEqual([`${LOCKED_ID}.json`, 'session_readable.json'].sort());
  });

  it('-r <name> of a session it cannot read names the sealed sessions instead of "not found"', async () => {
    const result = await run(project, ['-p', 'hi', '-r', 'kept name']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'No readable session matches kept name. 1 saved session is sealed with keys this process ' +
        'does not have.\n',
    );
    expect(result.stderr).not.toContain('not found');
  });

  it.each([
    ['corrupt', '{ not json', 'the session store reported "corrupt" for its record.'],
    [
      'unsupported',
      JSON.stringify({ schemaVersion: 99, record: { id: 'session_unreadable' } }),
      'the session store reported "unsupported" for its record.',
    ],
  ])(
    'the terminal UI path refuses a %s record before it mounts, instead of throwing in its first render',
    async (_status, content, refusal) => {
      writeFileSync(join(sessionsDirectory, 'session_unreadable.json'), content, 'utf8');
      const presentation = spiedPresentation();

      const result = await run(project, ['-r', 'session_unreadable'], presentation);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`Cannot resume session session_unreadable: ${refusal}\n`);
      expect(presentation.renderApp).not.toHaveBeenCalled();
      expect(presentation.installTuiProcessGuards).not.toHaveBeenCalled();
      expect(readFileSync(join(sessionsDirectory, 'session_unreadable.json'), 'utf8')).toBe(
        content,
      );
    },
  );
});
