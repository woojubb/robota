import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createNodeHostSettingsSource } from '../../config/settings-source.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { loadSessionPluginSkills, sessionPluginDirectories } from '../session-plugin-skills.js';

// The scope takes the host's synchronous files, as the session reads them off `host.files.sync`.
const files = createTestFrameworkHost().files?.sync;

const roots: string[] = [];
function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'session-plugin-skills-')));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('sessionPluginDirectories', () => {
  it('admits a project plugin folder inside the trusted worktree, then the user folder', async () => {
    const root = tempRoot();
    const access = await createTrustedProjectAccessFixture(root);
    mkdirSync(join(root, 'plugins'));
    const dirs = sessionPluginDirectories({
      fs: files,
      projectAccess: access,
      pluginDirectories: { project: join(root, 'plugins'), user: '/home/me/plugins' },
    });
    expect(dirs).toEqual([join(root, 'plugins'), '/home/me/plugins']);
  });

  it('judges a project folder that does not exist yet by where it would be', async () => {
    const root = tempRoot();
    const access = await createTrustedProjectAccessFixture(root);
    const dirs = sessionPluginDirectories({
      fs: files,
      projectAccess: access,
      pluginDirectories: { project: join(root, 'not', 'yet') },
    });
    expect(dirs).toEqual([join(root, 'not', 'yet')]);
  });

  it('refuses a project folder outside the trusted worktree, through a link or by its own path', async () => {
    const root = tempRoot();
    const elsewhere = tempRoot();
    const access = await createTrustedProjectAccessFixture(root);
    symlinkSync(elsewhere, join(root, 'link'));
    for (const project of [
      elsewhere,
      join(root, 'link'),
      join(root, '..', 'sibling'),
      'relative',
    ]) {
      expect(
        sessionPluginDirectories({
          fs: files,
          projectAccess: access,
          pluginDirectories: { project },
        }),
        project,
      ).toEqual([]);
    }
  });

  it('admits no project folder when the host lends no files to prove it inside the worktree', async () => {
    const root = tempRoot();
    const access = await createTrustedProjectAccessFixture(root);
    expect(
      sessionPluginDirectories({
        fs: undefined,
        projectAccess: access,
        pluginDirectories: { project: join(root, 'plugins'), user: '/home/me/plugins' },
      }),
    ).toEqual(['/home/me/plugins']);
  });
});

describe('loadSessionPluginSkills on a host that lends no files', () => {
  const userSettings = [createNodeHostSettingsSource('user', '/home/me/settings.json')];

  it('refuses to build a session that names plugin directories it cannot read', () => {
    expect(() =>
      loadSessionPluginSkills({
        fs: undefined,
        userSettingsSources: userSettings,
        pluginDirectories: { user: '/home/me/plugins' },
      }),
    ).toThrow(/`pluginDirectories`.*`host\.files`/);
  });

  it('loads nothing, without complaint, when no plugin directory was named', () => {
    expect(
      loadSessionPluginSkills({ fs: undefined, userSettingsSources: userSettings }),
    ).toEqual([]);
  });

  it('loads nothing for a bare session, which loads no plugins at all', () => {
    expect(
      loadSessionPluginSkills({
        fs: undefined,
        bare: true,
        userSettingsSources: userSettings,
        pluginDirectories: { user: '/home/me/plugins' },
      }),
    ).toEqual([]);
  });
});
