import { spawnSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { productEnvironment } from '../../packages/product-config/src/__tests__/product-environment.ts';
import { loadProductConfig } from '../../packages/product-config/src/node.ts';
import {
  generateWorkspaceFromEnvironmentFile,
  workflowProductEnvironment,
} from './generate-workspace.mjs';

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
  // Older default-branch Windows schedules still invoke this before generating the workspace.
  if (process.argv.includes('--prepare-pr-version')) return;
  const environment = { ...process.env };
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
  // The deployed default-branch schedule still builds only the CLI closure. Until it adopts the
  // separate SDK check, prepare those SDK artifacts for its existing Windows qualification steps.
  if (environment.GITHUB_WORKFLOW === 'Windows development' && environment.WINDOWS_SDK_SEPARATE !== 'true') {
    const filters = ['{packages/agent-file-authority}...', '{packages/agent-keyring}...', '{packages/agent-transport-link}...']
      .flatMap((value) => ['--filter', value]);
    for (const args of [['install', '--frozen-lockfile', '--filter', 'robota-monorepo', ...filters], ['-r', ...filters, 'run', 'build']]) {
      const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
        cwd: output, stdio: 'inherit', shell: process.platform === 'win32', timeout: 300_000,
      });
      if (result.error || result.status !== 0) throw new Error(`Legacy Windows SDK preparation failed: ${result.error?.message ?? result.status}`);
    }
  }
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
