import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {(file: string, args: string[], options: { cwd: string, env: NodeJS.ProcessEnv }) => void} TRunNpm
 */

/** @type {TRunNpm} */
const runNpm = (file, args, options) => {
  execFileSync(file, args, { ...options, stdio: ['ignore', 'inherit', 'inherit'] });
};

/**
 * Install the CLI under `tempDir`, running npm there rather than in the checkout: npm reads the
 * `.npmrc` of the directory it runs in, so a checkout could otherwise pick the registry, the script
 * shell, or a local copy of the package that runs instead of the real one.
 *
 * @param {string} packageSpec
 * @param {NodeJS.ProcessEnv} env
 * @param {{ tempDir: string, runNpm?: TRunNpm }} options
 * @returns {string} the CLI's entry script
 */
export function installCli(packageSpec, env, options) {
  const prefix = join(options.tempDir, 'robota-cli');
  mkdirSync(prefix, { recursive: true });
  (options.runNpm ?? runNpm)(
    'npm',
    [
      'install',
      '--prefix',
      prefix,
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      packageSpec,
    ],
    { cwd: prefix, env },
  );
  const packageDir = join(prefix, 'node_modules', '@robota-sdk', 'agent-cli');
  /** @type {{ bin?: string | Record<string, string> }} */
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['robota'];
  if (bin === undefined) throw new Error('the installed package declares no robota command');
  return join(packageDir, bin);
}

/**
 * Run the installed entry script with this Node, in the checkout: no shell, and no package runner
 * that would look in the checkout for the command.
 *
 * @param {string} entry
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @param {string} workspace
 * @returns {string} its stdout
 */
export function runCli(entry, args, env, workspace) {
  return execFileSync(process.execPath, [entry, ...args], {
    cwd: workspace,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}
