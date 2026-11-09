/**
 * `session release` removes a session's writer marker: on its own only one whose process has ended,
 * and with `--force` one whose process may still run, only at a terminal and after the user's yes.
 */

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { goneProcessOwner, leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runSessionReleaseCommand } from '../session-release-command.js';

import type { ISessionReleaseCommandOptions } from '../session-release-command.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function claimsDirectory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'session-release-')));
  roots.push(root);
  return join(root, 'sessions', 'claims');
}

/** A live process other than this one: the one that started this test worker. */
function liveOther() {
  const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
  const startTime = readProcessStartTime(process.ppid);
  return { ...here, pid: process.ppid, ...(startTime === undefined ? {} : { startTime }) };
}

async function release(
  argv: readonly string[],
  directory: string,
  extra: Partial<ISessionReleaseCommandOptions> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = await runSessionReleaseCommand(argv, {
    cliName: 'robota',
    locations: [{ label: 'your session store', directory }],
    isTTY: false,
    write: (text) => out.push(text),
    writeError: (text) => err.push(text),
    ...extra,
  });
  return { exitCode, stdout: out.join(''), stderr: err.join('') };
}

describe('session release', () => {
  it('says there is nothing to release when no marker stands', async () => {
    const result = await release(['sess_none'], claimsDirectory());

    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.stdout).toContain('Session sess_none has no writer marker');
  });

  it('removes a marker whose process has ended, without --force', async () => {
    const directory = claimsDirectory();
    const marker = leaveProcessMarker(directory, 'sess_crashed', goneProcessOwner());

    const result = await release(['sess_crashed'], directory);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Released session sess_crashed in your session store');
    expect(existsSync(marker)).toBe(false);
  });

  it('keeps a marker whose process may still run, naming it and the --force command', async () => {
    const directory = claimsDirectory();
    const other = liveOther();
    const marker = leaveProcessMarker(directory, 'sess_open', other);

    const result = await release(['sess_open'], directory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`pid ${other.pid}`);
    expect(result.stderr).toContain('robota session release sess_open --force');
    expect(existsSync(marker)).toBe(true);
  });

  it('refuses --force without a terminal, and keeps the marker', async () => {
    const directory = claimsDirectory();
    const marker = leaveProcessMarker(directory, 'sess_open', liveOther());
    const confirm = vi.fn(async () => true);

    const result = await release(['sess_open', '--force'], directory, { isTTY: false, confirm });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('needs an interactive terminal and your confirmation');
    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(true);
  });

  it('removes a live marker with --force only after the user says yes at the terminal', async () => {
    const directory = claimsDirectory();
    const other = liveOther();
    const marker = leaveProcessMarker(directory, 'sess_open', other);
    const questions: string[] = [];

    const declined = await release(['sess_open', '--force'], directory, {
      isTTY: true,
      confirm: async (question) => {
        questions.push(question);
        return false;
      },
    });
    expect(declined.exitCode).toBe(1);
    expect(existsSync(marker)).toBe(true);
    expect(questions[0]).toContain(`pid ${other.pid}`);
    expect(questions[0]).toContain('already running child processes may continue');
    expect(questions[0]).toContain('Stop the writer and its children first');

    const accepted = await release(['sess_open', '--force'], directory, {
      isTTY: true,
      confirm: async () => true,
    });
    expect(accepted.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses an id that is not one path component, and unknown flags', async () => {
    const directory = claimsDirectory();
    expect((await release(['../escape'], directory)).exitCode).toBe(1);
    expect((await release(['sess_a', '--yes'], directory)).exitCode).toBe(1);
    expect((await release([], directory)).stderr).toContain(
      'Usage: robota session release <session-id> [--force]',
    );
  });
});
