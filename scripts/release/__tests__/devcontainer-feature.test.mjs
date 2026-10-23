import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareFeature, publicationDisposition } from '../prepare-devcontainer-feature.mjs';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function workspace(id = 'cedar', version = '3.0.0-beta.96') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feature-test-'));
  roots.push(root);
  for (const directory of ['.product', 'packages/agent-cli', 'scripts'])
    await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(
    path.join(root, '.product/identity.json'),
    JSON.stringify({
      identity: {
        id,
        cliName: id,
        displayName: id.toUpperCase(),
        envPrefix: `${id.toUpperCase()}_`,
        repositoryUrl: `https://github.com/${id}/agent`,
      },
      release: { artifactPrefix: `${id}-bundle` },
    }),
  );
  await writeFile(
    path.join(root, 'packages/agent-cli/package.json'),
    JSON.stringify({
      name: `@${id}/agent-cli`,
      version,
      engines: { node: '>=22.12.0' },
    }),
  );
  await writeFile(path.join(root, 'scripts/install.sh'), '#!/bin/sh\necho selected-installer\n');
  return root;
}

describe('prepared Dev Container Feature', () => {
  it.each(['cedar', 'amber'])('uses the selected %s identity and one exact CLI pin', async (id) => {
    const root = await workspace(id);
    const result = await prepareFeature({ workspace: root, out: path.join(root, 'prepared') });
    const metadata = JSON.parse(
      await readFile(path.join(result.directory, 'devcontainer-feature.json'), 'utf8'),
    );
    expect(metadata).toMatchObject({
      id,
      version: '1.0.0',
      name: id.toUpperCase(),
      options: { version: { default: '3.0.0-beta.96' }, installMethod: { default: 'binary' } },
      containerEnv: {
        PRODUCT_USER_STATE_DIR: `/var/lib/${id}/state`,
        [`${id.toUpperCase()}_USER_STATE_DIR`]: `/var/lib/${id}/state`,
      },
      mounts: [
        {
          source: `${id}-state-\${devcontainerId}`,
          target: `/var/lib/${id}/state`,
          type: 'volume',
        },
      ],
    });
    expect(metadata).not.toHaveProperty('entrypoint');
    expect(metadata).not.toHaveProperty('securityOpt');
    expect(metadata).not.toHaveProperty('privileged');
    expect(await readFile(path.join(result.directory, 'binary-install.sh'), 'utf8')).toBe(
      await readFile(path.join(root, 'scripts/install.sh'), 'utf8'),
    );
    const config = await readFile(path.join(result.directory, 'feature.env'), 'utf8');
    expect(config).toContain(`FEATURE_NPM_PACKAGE='@${id}/agent-cli'`);
    expect(config).toContain(`FEATURE_INSTALL_ROOT='/usr/local/lib/${id}'`);
    expect(config).toContain(`FEATURE_STATE_VARIABLE='${id.toUpperCase()}_USER_STATE_DIR'`);
    expect(config).not.toContain('woojubb');
    expect(config).not.toContain('robota');
  });

  it('passes the validated state to the selected artifact environment alias', async () => {
    const root = await workspace();
    const state = path.join(root, 'private-state');
    await mkdir(state, { mode: 0o700 });
    const result = await prepareFeature({ workspace: root, out: path.join(root, 'prepared') });
    const launcher = path.join(root, 'launch.sh');
    const config = path.join(root, 'launcher.env');
    const executable = path.join(root, 'cli.sh');
    await writeFile(
      config,
      `FEATURE_EXECUTABLE='${executable}'\nFEATURE_STATE_ROOT='${state}'\nFEATURE_STATE_VARIABLE='CEDAR_USER_STATE_DIR'\n`,
    );
    await writeFile(executable, '#!/bin/sh\nprintf "%s" "$CEDAR_USER_STATE_DIR"\n', {
      mode: 0o755,
    });
    await writeFile(
      path.join(root, 'stat'),
      '#!/bin/sh\nprintf "%s:%s 700" "$(id -u)" "$(id -g)"\n',
      { mode: 0o755 },
    );
    const text = await readFile(path.join(result.directory, 'launch.sh'), 'utf8');
    await writeFile(launcher, text.replace('/usr/local/lib/cedar/launcher.env', config));
    expect(
      execFileSync('sh', [launcher], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PRODUCT_USER_STATE_DIR: state },
        encoding: 'utf8',
      }),
    ).toBe(state);
  });

  it('rejects a mutable default selector before preparing an installable artifact', async () => {
    const root = await workspace('cedar', 'latest');
    await expect(
      prepareFeature({ workspace: root, out: path.join(root, 'prepared') }),
    ).rejects.toThrow('exact CLI version');
  });

  it('refuses replacing an existing output directory', async () => {
    const root = await workspace();
    const out = path.join(root, 'prepared');
    await prepareFeature({ workspace: root, out });
    await expect(prepareFeature({ workspace: root, out })).rejects.toThrow('already exists');
  });

  it('permits an identical immutable-version retry and rejects a changed CLI pin', async () => {
    const first = await workspace();
    const next = await workspace('cedar', '3.0.0-beta.97');
    const before = await prepareFeature({ workspace: first, out: path.join(first, 'prepared') });
    const after = await prepareFeature({ workspace: next, out: path.join(next, 'prepared') });
    expect(publicationDisposition(before.release, before.release)).toBe('skip');
    expect(() => publicationDisposition(after.release, before.release)).toThrow(
      'Bump the authored Feature version',
    );
    expect(publicationDisposition(after.release, undefined)).toBe('publish');
  });

  it('prepares a deliberately bumped Feature version for a new CLI pin', async () => {
    const root = await workspace('cedar', '3.0.0-beta.97');
    const featureSource = path.join(root, 'source-feature');
    await cp(
      new URL('../../../devcontainer-features/src/robota/', import.meta.url),
      featureSource,
      { recursive: true },
    );
    const metadataFile = path.join(featureSource, 'devcontainer-feature.json');
    const metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
    metadata.version = '1.0.1';
    await writeFile(metadataFile, JSON.stringify(metadata));
    const next = await prepareFeature({
      workspace: root,
      out: path.join(root, 'prepared'),
      featureSource,
    });
    expect(next.release).toMatchObject({ featureVersion: '1.0.1', cliVersion: '3.0.0-beta.97' });
    expect(publicationDisposition(next.release, undefined)).toBe('publish');
  });
});
