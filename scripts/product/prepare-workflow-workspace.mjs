import { spawnSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { satisfies, valid, validRange } from 'semver';
import { parse } from 'yaml';

import { productEnvironment } from '../../packages/product-config/src/__tests__/product-environment.ts';
import { loadProductConfig } from '../../packages/product-config/src/node.ts';
import {
  generateWorkspaceFromEnvironmentFile,
  workflowProductEnvironment,
} from './generate-workspace.mjs';

const workflowPeers = [
  '@robota-sdk/agent-builtin-providers',
  '@robota-sdk/agent-core',
  '@robota-sdk/agent-framework',
  '@robota-sdk/agent-interface-command',
  '@robota-sdk/agent-tools',
];

async function workflowPeersMatch(sourceRoot) {
  const lock = parse(await readFile(path.join(sourceRoot, 'pnpm-lock.yaml'), 'utf8'));
  const importer =
    lock.importers?.['packages/agent-cli']?.devDependencies?.['@robota-sdk/workflows'];
  const specifier = importer?.specifier;
  const version = importer?.version;
  if (
    typeof specifier !== 'string' ||
    valid(specifier) !== specifier ||
    typeof version !== 'string' ||
    (version !== specifier && !version.startsWith(`${specifier}(`))
  )
    throw new Error('Workflow must use an exact locked registry version.');
  const artifact = lock.packages?.[`/@robota-sdk/workflows@${version}`];
  const peerDependencies = artifact?.peerDependencies;
  if (
    !peerDependencies ||
    Object.keys(peerDependencies).length !== workflowPeers.length ||
    workflowPeers.some((peer) => !Object.hasOwn(peerDependencies, peer))
  )
    throw new Error('Workflow peer names are missing or invalid.');
  let compatible = true;
  for (const peer of workflowPeers) {
    const range = peerDependencies[peer];
    const link = artifact.dependencies?.[peer];
    const packageDirectory = peer.slice('@robota-sdk/'.length);
    if (
      typeof range !== 'string' ||
      !validRange(range) ||
      link !== `link:packages/${packageDirectory}`
    )
      throw new Error(`Workflow peer ${peer} has an invalid range or workspace link.`);
    const manifest = JSON.parse(
      await readFile(path.join(sourceRoot, 'packages', packageDirectory, 'package.json'), 'utf8'),
    );
    if (manifest.name !== peer || typeof manifest.version !== 'string' || !valid(manifest.version))
      throw new Error(`Workflow peer ${peer} has an invalid SDK manifest.`);
    if (!satisfies(manifest.version, range)) compatible = false;
  }
  return compatible;
}

export async function ensurePrWorkflowVersion({ sourceRoot, isPullRequest, version }) {
  if (!isPullRequest)
    throw new Error('Workflow version preparation is only permitted for a pull request.');
  if (await workflowPeersMatch(sourceRoot)) return;
  await version();
  if (!(await workflowPeersMatch(sourceRoot)))
    throw new Error('Workflow peers still do not have a supported version.');
}

function versionPrCandidate(sourceRoot) {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpm, ['run', 'version'], {
    cwd: sourceRoot,
    stdio: 'inherit',
    timeout: 300_000,
    shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `PR candidate version generation failed: ${result.error?.message ?? result.status}`,
    );
}

export async function writeWorkflowProductEnvironment(environment) {
  if (!environment.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required.');
  const filePath = path.join(environment.RUNNER_TEMP, 'selected-product.env');
  let contents = environment.PRODUCT_BUILD_ENV;
  if (environment.IS_PULL_REQUEST === 'true') {
    const label = environment.FIXTURE_PRODUCT;
    if (label !== 'cedar' && label !== 'amber')
      throw new Error('Select a supported fixture product.');
    const values = {
      ...productEnvironment(label),
      PRODUCT_USER_STATE_DIR: path.join(environment.RUNNER_TEMP, label, 'user'),
      PRODUCT_CACHE_DIR: path.join(environment.RUNNER_TEMP, label, 'cache'),
      PRODUCT_LOG_DIR: path.join(environment.RUNNER_TEMP, label, 'logs'),
      SECURITY_MASTER_KEY_DERIVATION_PATH: label === 'cedar' ? '[173,0]' : '[179,0]',
      PROJECT_RELEASE_TAG_PREFIX: `${label}-v`,
      ...(environment.CI_VALIDATION === 'true'
        ? {
            PROJECT_REPOSITORY_URL: `${environment.GITHUB_SERVER_URL}/${environment.GITHUB_REPOSITORY}`,
            PROJECT_NPM_REGISTRY_URL: 'https://registry.npmjs.org',
            PROJECT_PACKAGE_ACCESS: 'public',
          }
        : {}),
    };
    contents = Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  } else if (!contents?.trim()) {
    throw new Error(
      'Select product_env or configure vars.PRODUCT_BUILD_ENV before building a release.',
    );
  }
  await writeFile(filePath, contents, { mode: 0o600 });
  return filePath;
}

async function main() {
  const environment = { ...process.env };
  if (process.argv.includes('--prepare-pr-version')) {
    const sourceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
    await ensurePrWorkflowVersion({
      sourceRoot,
      isPullRequest: environment.IS_PULL_REQUEST === 'true',
      version: () => versionPrCandidate(sourceRoot),
    });
    return;
  }
  const filePath = await writeWorkflowProductEnvironment(environment);
  if (process.argv.includes('--environment-only')) {
    const config = loadProductConfig({ environment, filePath });
    await appendFile(
      environment.GITHUB_ENV,
      workflowProductEnvironment(
        config,
        filePath,
        path.join(environment.RUNNER_TEMP, 'product-workspace'),
      ),
      { mode: 0o600 },
    );
    return;
  }
  const output = await generateWorkspaceFromEnvironmentFile({
    filePath,
    outDir: path.join(environment.RUNNER_TEMP, 'product-workspace'),
    environment,
    environmentOutput: environment.GITHUB_ENV,
    stepOutput: environment.GITHUB_OUTPUT,
  });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
