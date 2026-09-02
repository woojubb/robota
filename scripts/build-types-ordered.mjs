#!/usr/bin/env node
/**
 * Runs build:types for packages under packages/** in strict topological order.
 * Independent packages in one tier execute concurrently, while their captured
 * output is rendered in package-name order after the tier completes.
 */

import { spawn } from 'node:child_process';
import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { listManifestPackageDirs } from './harness/workspace-packages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export function defaultBuildTypeConcurrency() {
  const available =
    typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(4, available || 1));
}

export function findBuildTypePackages(workspaceRoot = root) {
  const results = new Map(); // name -> pkg info
  for (const packageDir of listManifestPackageDirs(workspaceRoot)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    if (!pkg.name || !pkg.scripts?.['build:types'] || results.has(pkg.name)) continue;
    results.set(pkg.name, { name: pkg.name, dir: packageDir, manifest: pkg });
  }
  return [...results.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function localDependencies(pkg, localNames) {
  const names = new Set();
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(pkg.manifest[field] ?? {})) {
      if (localNames.has(name)) names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function createBuildTypeTiers(discoveredPackages) {
  const packages = [...discoveredPackages].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const localNames = new Set(packages.map((pkg) => pkg.name));
  const normalized = packages.map((pkg) => ({
    ...pkg,
    deps: localDependencies(pkg, localNames),
  }));
  const byName = new Map(normalized.map((pkg) => [pkg.name, pkg]));
  const tiers = [];
  const built = new Set();

  while (built.size < normalized.length) {
    const tier = normalized.filter((p) => {
      if (built.has(p.name)) return false;
      return p.deps.every((d) => !byName.has(d) || built.has(d));
    });

    if (tier.length === 0) {
      const remaining = normalized.filter((p) => !built.has(p.name));
      const details = remaining.map(
        (p) =>
          `${p.name} (waiting on: ${p.deps.filter((d) => byName.has(d) && !built.has(d)).join(', ')})`,
      );
      throw new Error(`Circular dependencies detected:\n  ${details.join('\n  ')}`);
    }

    tiers.push(tier);
    tier.forEach((p) => built.add(p.name));
  }

  return tiers;
}

export function selectBuildTypePackages(discoveredPackages, requestedNames = []) {
  if (requestedNames.length === 0) return [...discoveredPackages];

  const byName = new Map(discoveredPackages.map((pkg) => [pkg.name, pkg]));
  const unknown = [...new Set(requestedNames)].filter((name) => !byName.has(name)).sort();
  if (unknown.length > 0) {
    throw new Error(`Unknown or non-buildable package(s): ${unknown.join(', ')}`);
  }

  const selected = new Set();
  const visit = (name) => {
    if (selected.has(name)) return;
    selected.add(name);
    const pkg = byName.get(name);
    for (const dependency of localDependencies(pkg, new Set(byName.keys()))) {
      visit(dependency);
    }
  };
  for (const name of requestedNames) visit(name);

  return [...selected]
    .map((name) => byName.get(name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function executeBuildType(pkg) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['build:types'], {
      cwd: pkg.dir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ status: 1, signal: null, stdout, stderr, error }));
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

export async function runBuildTypeTier(
  packages,
  {
    concurrency = defaultBuildTypeConcurrency(),
    runPackage = executeBuildType,
    write = (value) => process.stdout.write(value),
  } = {},
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Build concurrency must be a positive integer, received: ${concurrency}`);
  }

  const ordered = [...packages].sort((left, right) => left.name.localeCompare(right.name));
  const results = new Array(ordered.length);
  let cursor = 0;

  async function worker() {
    while (cursor < ordered.length) {
      const index = cursor;
      cursor += 1;
      const pkg = ordered[index];
      try {
        results[index] = await runPackage(pkg);
      } catch (error) {
        results[index] = { status: 1, signal: null, stdout: '', stderr: '', error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ordered.length) }, () => worker()));

  for (let index = 0; index < ordered.length; index += 1) {
    const pkg = ordered[index];
    const result = results[index];
    write(`\n[build:types] ${pkg.name}\n`);
    if (result.stdout) write(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
    if (result.stderr) write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
  }

  const failures = ordered
    .map((pkg, index) => ({ pkg, result: results[index] }))
    .filter(({ result }) => result.status !== 0 || result.signal || result.error);
  if (failures.length > 0) {
    const details = failures.map(({ pkg, result }) => {
      const reason = result.error?.message ?? result.signal ?? `exit ${result.status}`;
      return `${pkg.name} (${reason})`;
    });
    throw new Error(`FAILED build:types: ${details.join(', ')}`);
  }

  return results;
}

export function parseBuildTypeArgs(argv) {
  const options = {
    concurrency: Number.parseInt(process.env.ROBOTA_BUILD_TYPES_CONCURRENCY ?? '', 10),
    packageNames: [],
  };
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    options.concurrency = defaultBuildTypeConcurrency();
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === '--concurrency') {
      const value = Number.parseInt(argv[index + 1] ?? '', 10);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--concurrency requires a positive integer');
      }
      options.concurrency = value;
      index += 1;
      continue;
    }
    if (token === '--package') {
      const value = argv[index + 1];
      if (!value) throw new Error('--package requires a workspace package name');
      options.packageNames.push(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

async function main() {
  const options = parseBuildTypeArgs(process.argv.slice(2));
  const discovered = findBuildTypePackages();
  const packages = selectBuildTypePackages(discovered, options.packageNames);
  console.log(
    `Building types for ${packages.length} packages in topological order ` +
      `(concurrency ${options.concurrency})...\n`,
  );

  const tiers = createBuildTypeTiers(packages);

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const names = tier.map((p) => p.name.replace('@robota-sdk/', '')).join(', ');
    console.log(`Tier ${i + 1}/${tiers.length} [${tier.length} packages]: ${names}`);
    await runBuildTypeTier(tier, { concurrency: options.concurrency });
    console.log(`  ✓ done\n`);
  }

  console.log('✓ All build:types complete.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error('\n' + e.message);
    process.exit(1);
  });
}
