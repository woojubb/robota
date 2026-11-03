/**
 * `session analyze` with sealed sessions whose keys are locked: a session that is there but sealed
 * is not "not found", and an analysis with nothing readable says why instead of "no session files".
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSessionAnalyze } from '../session-analyze-command.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    messages: [],
    history: [],
  };
}

describe('session analyze with locked sealed sessions', () => {
  let dir: string;
  let stderr: string[];
  let exitCode: number | undefined;
  const sealer = createTestArtifactSealer();

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'analyze-locked-')));
    stderr = [];
    exitCode = undefined;
    sealer.unlock();
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    }) as never);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit:${exitCode}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  /** One sealed session, locked; and a plain one beside it when `withReadable`. */
  async function run(argv: string[], withReadable = false): Promise<void> {
    sealer.unlock();
    const store = createNodeHostSessionStore(dir, undefined, { sealing: { sealer } });
    store.save(record('session_1781000001000_aaa'));
    sealer.lock();
    if (withReadable) {
      createNodeHostSessionStore(dir, undefined, { sealing: 'plain' }).save(
        record('session_1781000002000_bbb'),
      );
    }
    try {
      await runSessionAnalyze(argv, dir, undefined, store);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('process.exit:')) throw error;
    }
  }

  it('names a locked session instead of calling it not found', async () => {
    await run(['--session', 'session_1781000001000_aaa']);
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toBe(
      'Session session_1781000001000_aaa is sealed and locked; unlock to open it.\n',
    );
  });

  it('says so with other readable sessions around, and in --usage mode too', async () => {
    await run(['--session', 'session_1781000001000_aaa'], true);
    expect(stderr.join('')).toBe(
      'Session session_1781000001000_aaa is sealed and locked; unlock to open it.\n',
    );
    stderr.length = 0;
    await run(['--usage', '--session', 'session_1781000001000_aaa'], true);
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('is sealed and locked; unlock to open it.');
    expect(stderr.join('')).not.toContain('not found');
  });

  it('still says not found for an id that is not there', async () => {
    await run(['--session', 'session_9999999999999_zzz'], true);
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('Session not found: session_9999999999999_zzz');
  });

  it.each([
    ['the latest session', []],
    ['--last', ['--last', '5']],
    ['a substring match', ['--session', '2000']],
    ['--usage of the latest session', ['--usage']],
  ])('says how many locked sessions it skipped when analyzing %s', async (_label, argv) => {
    await run(argv, true);
    expect(exitCode).toBeUndefined();
    expect(stderr.join('')).toBe(
      'Skipped: 1 saved session is sealed and locked; unlock to open it.\n',
    );
  });

  it('explains an empty analysis by the locked sessions', async () => {
    await run([]);
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('No session files found');
    expect(stderr.join('')).toContain('1 saved session is sealed and locked; unlock to open it.');
  });
});
