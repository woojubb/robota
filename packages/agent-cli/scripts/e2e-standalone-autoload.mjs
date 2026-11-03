#!/usr/bin/env node
/**
 * The packaged executable must run only the code compiled into it. This starts it inside a directory that
 * stands in for a freshly cloned repository: its bunfig.toml preloads a script that writes a marker, and its
 * .env points the user state root somewhere else. Either taking effect fails the check. Each probe has a
 * positive control so a pass is never vacuous: the planted script writes its marker when run directly, and the
 * same variable visibly changes `--help` when it comes from the real environment. Bun runtime variables such
 * as BUN_OPTIONS and BUN_BE_BUN are out of scope: whoever sets them already controls the process as the same
 * OS user.
 *
 *   node scripts/e2e-standalone-autoload.mjs <agent-executable> [--env-prefix <PREFIX_>]
 *
 * The prefix defaults to the selected product identity's environment prefix.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fixtureProcessEnvironment,
  selectedFixtureIdentity,
} from './product-fixture-environment.mjs';

function failure(label, result) {
  return new Error(
    `${label} (status ${String(result.status)}).\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
  );
}

/**
 * The environment every probe runs in: the host basics and the temporary HOME, and no `PRODUCT_*` variable at
 * all, so the executable runs on the identity compiled into it. When those variables name the same product as
 * the binary (a generated product workspace) they are all honoured, a state root among them becomes required,
 * and it conflicts with `<prefix>USER_STATE_DIR`: the control would fail for a reason that has nothing to do
 * with autoloading. A loaded `.env` must also find the prefixed variable unset, since dotenv never overrides
 * one. The temporary HOME keeps the default state root away from the real one.
 */
export function standaloneAutoloadEnvironment(home, stateVariable) {
  const env = fixtureProcessEnvironment(home);
  for (const key of Object.keys(env)) {
    if (key.startsWith('PRODUCT_') || key === stateVariable) delete env[key];
  }
  return env;
}

export function runStandaloneAutoloadE2e(binaryPath, options = {}) {
  const envPrefix = options.envPrefix ?? selectedFixtureIdentity().identity.envPrefix;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-standalone-autoload-')));
  try {
    const repository = join(root, 'cloned-repository');
    mkdirSync(repository);
    const marker = join(root, 'planted-preload-ran');
    const preload = join(repository, 'planted-preload.js');
    writeFileSync(
      preload,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'planted');\n`,
    );
    writeFileSync(join(repository, 'bunfig.toml'), 'preload = ["./planted-preload.js"]\n');
    const stateVariable = `${envPrefix}USER_STATE_DIR`;
    // Compared by its unique final segment, so a platform's path spelling in the output cannot hide it.
    const plantedName = 'planted-user-state';
    const plantedState = join(root, plantedName);
    writeFileSync(join(repository, '.env'), `${stateVariable}=${plantedState}\n`);

    const env = standaloneAutoloadEnvironment(join(root, 'home'), stateVariable);
    const run = (args, extra = {}) =>
      spawnSync(resolve(binaryPath), args, {
        cwd: repository,
        env: { ...env, ...extra },
        encoding: 'utf8',
        timeout: 60_000,
      });

    const control = spawnSync(process.execPath, [preload], { cwd: root, encoding: 'utf8' });
    if (!existsSync(marker))
      throw failure('Control: the planted preload did not write its marker', control);
    rmSync(marker);
    const directed = run(['--help'], { [stateVariable]: plantedState });
    if (directed.status !== 0 || !directed.stdout.includes(plantedName)) {
      throw failure(
        `Control: ${stateVariable} from the environment did not show in --help`,
        directed,
      );
    }

    const version = run(['--version']);
    if (version.status !== 0) throw failure('--version in the planted repository failed', version);
    const help = run(['--help']);
    if (help.status !== 0) throw failure('--help in the planted repository failed', help);
    if (existsSync(marker)) {
      throw new Error('The executable ran a bunfig.toml preload from its working directory.');
    }
    if (help.stdout.includes(plantedName)) {
      throw new Error(
        `The executable loaded ${stateVariable} from a .env file in its working directory.`,
      );
    }
    return 'standalone-autoload=passed; bunfig.toml preload=ignored; .env=ignored';
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [binaryPath, flag, envPrefix] = process.argv.slice(2);
    if (!binaryPath || (flag !== undefined && (flag !== '--env-prefix' || !envPrefix))) {
      throw new Error(
        'Usage: e2e-standalone-autoload.mjs <agent-executable> [--env-prefix <PREFIX_>]',
      );
    }
    process.stdout.write(`${runStandaloneAutoloadE2e(binaryPath, { envPrefix })}\n`);
  } catch (error) {
    process.stderr.write(
      `standalone-autoload e2e: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
