import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeHostSettingsSource } from '../../config/settings-source.js';
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

function sessionOn(
  host: IFrameworkHost,
  extra: Partial<ConstructorParameters<typeof InteractiveSession>[0]> = {},
): InteractiveSession {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'session-host-absent-')));
  roots.push(cwd);
  return new InteractiveSession({
    host,
    cwd,
    provider: createScriptedProvider([]).provider,
    bare: true,
    ...extra,
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

describe('InteractiveSession plugin directories', () => {
  it('refuses to be built when it names plugin directories and the host lends no files', () => {
    expect(() =>
      sessionOn(createTestFrameworkHost({ files: undefined }), {
        bare: false,
        userSettingsSources: [createNodeHostSettingsSource('user', '/home/me/settings.json')],
        pluginDirectories: { user: '/home/me/plugins' },
      }),
    ).toThrow(/`pluginDirectories`.*`host\.files`/);
  });
});
