/**
 * OBS-001 integration tests: the `session analyze` command must read sessions from the
 * PROJECT store (cwd/.robota/sessions) — where print/TUI actually persist them — as well as
 * the user level, and its --last/--session flags must work. These cover the two integration
 * bugs that the parser/reporter unit tests could not catch (TC-01/02/06/07).
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSessionAnalyze } from '../session-analyze-command.js';

function sessionRecord(id: string, cwd: string): unknown {
  const t = (ms: number): string => new Date(1_781_000_000_000 + ms).toISOString();
  return {
    id,
    cwd,
    createdAt: t(0),
    updatedAt: t(20_000),
    history: [
      { id: 'h1', timestamp: t(0), category: 'chat', type: 'user' },
      { id: 'h2', timestamp: t(2_000), category: 'event', type: 'tool-start' },
      { id: 'h3', timestamp: t(2_300), category: 'event', type: 'tool-end' },
      // tool-end → assistant gap of 12s exercises the "Slow intervals (>10s)" path.
      { id: 'h4', timestamp: t(14_300), category: 'chat', type: 'assistant' },
    ],
  };
}

function writeSession(sessionsDir: string, id: string, cwd: string): void {
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, `${id}.json`), JSON.stringify(sessionRecord(id, cwd)), 'utf8');
}

describe('runSessionAnalyze integration (OBS-001)', () => {
  let home: string;
  let project: string;
  let stdout: string[];
  let stderr: string[];
  let exitCode: number | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'robota-obs-home-'));
    project = mkdtempSync(join(tmpdir(), 'robota-obs-proj-'));
    vi.stubEnv('HOME', home);
    stdout = [];
    stderr = [];
    exitCode = undefined;
    vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => {
      stdout.push(String(c));
      return true;
    }) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => {
      stderr.push(String(c));
      return true;
    }) as never);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit:${exitCode}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  async function run(argv: string[]): Promise<void> {
    try {
      await runSessionAnalyze(argv, project);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('process.exit:')) throw error;
    }
  }

  it('TC-01: analyzes the most recent PROJECT-level session (the real storage location)', async () => {
    writeSession(join(project, '.robota', 'sessions'), 'session_1781000001000_aaa', project);

    await run([]);

    expect(exitCode).toBeUndefined(); // no exit() on success
    const out = stdout.join('');
    expect(out).toContain('session_1781000001000_aaa');
    expect(out).toMatch(/Timing|LLM|Tool|Slow/i);
  });

  it('TC-02: --last aggregates multiple sessions (flag is delivered, not rejected)', async () => {
    const dir = join(project, '.robota', 'sessions');
    writeSession(dir, 'session_1781000001000_aaa', project);
    writeSession(dir, 'session_1781000002000_bbb', project);

    await run(['--last', '10']);

    const out = stdout.join('');
    expect(out).toMatch(/Analyzed 2 session|sessions/i);
    expect(stderr.join('')).not.toContain('Unknown option');
  });

  it('TC-06: no sessions in either location → stderr error + exit 1', async () => {
    await run([]);

    expect(exitCode).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('No session files found');
    // names BOTH searched locations
    expect(err).toContain(join(project, '.robota', 'sessions'));
    expect(err).toContain('.robota/sessions');
  });

  it('TC-07: --session <prefix> selects a specific session', async () => {
    const dir = join(project, '.robota', 'sessions');
    writeSession(dir, 'session_1781000001000_aaa', project);
    writeSession(dir, 'session_1781000002000_bbb', project);

    await run(['--session', '1781000002000']);

    const out = stdout.join('');
    expect(out).toContain('session_1781000002000_bbb');
    expect(out).not.toContain('session_1781000001000_aaa');
  });

  it('TC-07b: --session with an unknown id → error + exit 1', async () => {
    writeSession(join(project, '.robota', 'sessions'), 'session_1781000001000_aaa', project);

    await run(['--session', 'doesnotexist']);

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('Session not found');
  });

  it('merges user-level and project-level sessions (project wins on id collision)', async () => {
    writeSession(join(home, '.robota', 'sessions'), 'session_1781000000500_user', project);
    writeSession(join(project, '.robota', 'sessions'), 'session_1781000003000_proj', project);

    await run(['--last', '10']);

    const out = stdout.join('');
    expect(out).toMatch(/Analyzed 2 session/i);
  });
});
