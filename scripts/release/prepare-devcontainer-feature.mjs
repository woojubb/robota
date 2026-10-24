#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../devcontainer-features/src/robota/', import.meta.url));
const exactVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
const identifier = /^[a-z0-9][a-z0-9._-]*$/u;
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

export function publicationDisposition(current, existing) {
  if (existing === undefined) return 'publish';
  if (existing.featureVersion !== current.featureVersion || existing.id !== current.id)
    throw new Error('Existing receipt must name this exact Feature version and identity.');
  if (existing.contentDigest !== current.contentDigest)
    throw new Error(
      'Bump the authored Feature version before publishing a changed bundle or default CLI pin.',
    );
  return 'skip';
}

export async function prepareFeature({ workspace, out, featureSource = source }) {
  const identity = JSON.parse(
    await readFile(path.join(workspace, '.product/identity.json'), 'utf8'),
  );
  const manifest = JSON.parse(
    await readFile(path.join(workspace, 'packages/agent-cli/package.json'), 'utf8'),
  );
  const metadata = JSON.parse(
    await readFile(path.join(featureSource, 'devcontainer-feature.json'), 'utf8'),
  );
  if (!exactVersion.test(manifest.version)) throw new Error('An exact CLI version is required.');
  if (!exactVersion.test(metadata.version))
    throw new Error('An authored Feature semantic version is required.');
  const id = identity.identity.id.toLowerCase();
  if (!identifier.test(id)) throw new Error('Product ID must be a valid Feature identifier.');
  const envPrefix = identity.identity.envPrefix;
  if (!/^[A-Z][A-Z0-9_]*_$/.test(envPrefix ?? ''))
    throw new Error('Product environment prefix is invalid.');
  const stateVariable = `${envPrefix}USER_STATE_DIR`;
  const cliName = identity.identity.cliName;
  if (!/^[A-Za-z0-9._-]+$/u.test(cliName)) throw new Error('Product CLI name is invalid.');
  if (!/^@[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(manifest.name))
    throw new Error('A scoped CLI package is required.');
  try {
    await lstat(out);
    throw new Error('Feature output already exists.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const directory = path.join(out, id);
  await mkdir(directory, { recursive: true });
  const stateRoot = `/var/lib/${id}/state`;
  const installRoot = `/usr/local/lib/${id}`;
  metadata.id = id;
  metadata.name = identity.identity.displayName;
  metadata.options.version.default = manifest.version;
  metadata.containerEnv = { PRODUCT_USER_STATE_DIR: stateRoot, [stateVariable]: stateRoot };
  metadata.mounts = [
    { source: `${id}-state-\${devcontainerId}`, target: stateRoot, type: 'volume' },
  ];
  if (identity.identity.repositoryUrl) {
    metadata.documentationURL = `${identity.identity.repositoryUrl}/tree/main/devcontainer-features`;
    metadata.licenseURL = `${identity.identity.repositoryUrl}/blob/main/LICENSE`;
  }
  await writeFile(
    path.join(directory, 'devcontainer-feature.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  for (const name of ['install.sh', 'launch.sh']) {
    let text = await readFile(path.join(featureSource, name), 'utf8');
    text = text.replaceAll('__FEATURE_LAUNCHER_CONFIG__', `${installRoot}/launcher.env`);
    await writeFile(path.join(directory, name), text, { mode: 0o755 });
  }
  await copyFile(
    path.join(workspace, 'scripts/install.sh'),
    path.join(directory, 'binary-install.sh'),
  );
  const values = {
    FEATURE_CLI_NAME: cliName,
    FEATURE_CLI_VERSION: manifest.version,
    FEATURE_NPM_PACKAGE: manifest.name,
    FEATURE_ARTIFACT_PREFIX: identity.release.artifactPrefix ?? cliName,
    FEATURE_STATE_ROOT: stateRoot,
    FEATURE_STATE_VARIABLE: stateVariable,
    FEATURE_INSTALL_ROOT: installRoot,
  };
  await writeFile(
    path.join(directory, 'feature.env'),
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join('\n')}\n`,
  );
  const digest = createHash('sha256');
  for (const name of (await readdir(directory)).sort()) {
    digest.update(name);
    digest.update('\0');
    digest.update(await readFile(path.join(directory, name)));
    digest.update('\0');
  }
  const release = {
    id,
    featureVersion: metadata.version,
    cliVersion: manifest.version,
    contentDigest: digest.digest('hex'),
  };
  await writeFile(
    path.join(directory, 'feature-release.json'),
    `${JSON.stringify(release, null, 2)}\n`,
  );
  return { directory, release };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--workspace' || args[2] !== '--out')
    throw new Error(
      'Usage: node scripts/release/prepare-devcontainer-feature.mjs --workspace <generated workspace> --out <new directory>',
    );
  process.stdout.write(
    `${JSON.stringify(await prepareFeature({ workspace: path.resolve(args[1]), out: path.resolve(args[3]) }))}\n`,
  );
}
