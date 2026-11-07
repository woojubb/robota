import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IFrameworkHost } from '../../host/framework-host.js';

/**
 * What an `InteractiveSession` does on a host that lends less than the Node host: each capability it
 * lacks is absent, and the session says so instead of reaching for the process it runs in.
 */
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sessionOn(host: IFrameworkHost): InteractiveSession {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'session-host-absent-')));
  roots.push(cwd);
  return new InteractiveSession({
    host,
    cwd,
    provider: createScriptedProvider([]).provider,
    bare: true,
  } as ConstructorParameters<typeof InteractiveSession>[0]);
}

describe('InteractiveSession project reads', () => {
  it('reports project changes as failed, running nothing, when the host cannot run git', async () => {
    const session = sessionOn(createTestFrameworkHost({ git: undefined }));
    const status = await session.readProjectStatus();
    expect(status).toEqual({
      kind: 'failed',
      message: expect.stringMatching(/cannot run git/),
    });
    expect(await session.readProjectDiff('a.txt')).toEqual({
      kind: 'failed',
      message: expect.stringMatching(/cannot run git/),
    });
  });

  it('refuses a file diff, running no git, when the host lends no files to check containment', async () => {
    const run = vi.fn();
    const session = sessionOn(createTestFrameworkHost({ git: { run }, files: undefined }));
    expect(await session.readProjectDiff('a.txt')).toEqual({
      kind: 'failed',
      message: expect.stringMatching(/cannot read files/),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('still reads project status through whatever git the host gave it', async () => {
    const run = vi.fn(async () => ({
      kind: 'failed' as const,
      reason: 'not-found' as const,
      detail: 'no git here',
    }));
    const session = sessionOn(createTestFrameworkHost({ git: { run } }));
    const status = await session.readProjectStatus();
    expect(run).toHaveBeenCalled();
    expect(status).toEqual({ kind: 'failed', message: expect.stringContaining('no git here') });
  });
});

describe('InteractiveSession replay validation', () => {
  it('says the check is unavailable, naming the host member, when the host supplies no reader', () => {
    const session = sessionOn(createTestFrameworkHost({ validateSessionReplayLog: undefined }));
    expect(() => session.validateCurrentSessionReplayLog()).toThrow(
      /Session replay validation is unavailable[\s\S]*`validateSessionReplayLog`/u,
    );
  });

  it('reads the log through the host reader, with the session id', async () => {
    const report = {
      logFile: '/workspace/session.jsonl',
      entryCount: 0,
      validation: { ok: true as const, issues: [] },
    };
    const validate = vi.fn((_access: unknown, _sessionId: string) => report);
    const session = sessionOn(createTestFrameworkHost({ validateSessionReplayLog: validate }));
    await session.whenInitialized();
    expect(session.validateCurrentSessionReplayLog()).toBe(report);
    expect(validate).toHaveBeenCalledOnce();
    expect(typeof validate.mock.calls[0]?.[1]).toBe('string');
  });
});
