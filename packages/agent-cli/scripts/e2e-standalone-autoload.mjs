#!/usr/bin/env node
/**
 * The packaged executable must run only the code compiled into it. This starts it inside a directory that
 * stands in for a freshly cloned repository: its bunfig.toml preloads a script that writes a marker, and its
 * .env points the user state root somewhere else. Either taking effect fails the check. Each probe has a
 * positive control so a pass is never vacuous: the planted script writes its marker when run directly, and the
 * same variable, set alone in the real environment, takes the effect the .env probe looks for. Bun runtime variables such
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
 * The environment every probe runs in: the fixture's, without `<prefix>USER_STATE_DIR`, so a loaded `.env` would
 * find it unset (dotenv never overrides a variable). A product binary needs the fixture's `PRODUCT_*` values at
 * run time when they name its own product, and then requires `PRODUCT_USER_STATE_DIR` and the prefixed variable to
 * agree, so a `.env` that sets the prefixed one shows either as its value in `--help` (the variables were not
 * honoured) or as a refusal that names it (they were).
 */
export function standaloneAutoloadEnvironment(home, stateVariable) {
  const env = fixtureProcessEnvironment(home);
  delete env[stateVariable];
  return env;
}

/**
 * Whether `stateVariable` set to the planted root took effect in a run: its value in the output, or the
 * refusal a binary of the fixture's own product gives when it disagrees with `PRODUCT_USER_STATE_DIR`.
 */
export function stateVariableTookEffect(result, plantedName, stateVariable) {
  return (
    `${result.stdout ?? ''}`.includes(plantedName) ||
    (result.status !== 0 && `${result.stderr ?? ''}`.includes(stateVariable))
  );
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
    // Exactly what a loaded .env would add, so the control proves the probe below can see it.
    const directed = run(['--help'], { [stateVariable]: plantedState });
    if (!stateVariableTookEffect(directed, plantedName, stateVariable)) {
      throw failure(`Control: ${stateVariable} from the environment had no visible effect`, directed);
    }

    const loadedDotenv = (result) => stateVariableTookEffect(result, plantedName, stateVariable);
    const version = run(['--version']);
    const help = run(['--help']);
    if (existsSync(marker)) {
      throw new Error('The executable ran a bunfig.toml preload from its working directory.');
    }
    if (loadedDotenv(version) || loadedDotenv(help)) {
      throw new Error(
        `The executable loaded ${stateVariable} from a .env file in its working directory.`,
      );
    }
    if (version.status !== 0) throw failure('--version in the planted repository failed', version);
    if (help.status !== 0) throw failure('--help in the planted repository failed', help);
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
