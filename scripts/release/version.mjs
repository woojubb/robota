#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const executable = (name) =>
  path.join(
    sourceRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );

function run(command, args, cwd, timeout = 120_000) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.status}`,
    );
}

function output(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr ?? result.status}`,
    );
  return result.stdout;
}

function nextPatch(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) throw new Error(`Dev Container Feature version is not stable semver: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function updateFeature(workspace) {
  const cli = JSON.parse(
    readFileSync(path.join(workspace, 'packages/agent-cli/package.json'), 'utf8'),
  );
  const featurePath = path.join(
    workspace,
    'devcontainer-features/src/robota/devcontainer-feature.json',
  );
  const feature = JSON.parse(readFileSync(featurePath, 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(cli.version))
    throw new Error(`Agent CLI version is not exact semver: ${cli.version}`);
  if (feature.options?.version?.default === cli.version)
    throw new Error(
      `Dev Container Feature already pins ${cli.version}; no release bump was generated.`,
    );
  feature.version = nextPatch(feature.version);
  feature.options.version.default = cli.version;
  writeFileSync(featurePath, `${JSON.stringify(feature, null, 2)}\n`);
}

export function generateVersion(workspace) {
  run(executable('changeset'), ['version'], workspace);
  run(pnpm, ['install', '--lockfile-only', '--ignore-scripts'], workspace);
  updateFeature(workspace);
  const changed = output('git', ['diff', '--name-only', '-z', '--diff-filter=ACM'], workspace)
    .split('\0')
    .filter((file) => /\.(?:json|md|ya?ml)$/u.test(file));
  if (changed.length) run(executable('prettier'), ['--write', ...changed], workspace, 60_000);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--workspace')
  throw new Error('Usage: node scripts/release/version.mjs --workspace <repository>');
generateVersion(path.resolve(args[1]));
