#!/usr/bin/env node
/**
 * Runs build:types for packages under packages/** in strict topological order.
 * Packages are executed one tier at a time in deterministic order.
 */

import { execSync } from 'child_process';
import fs from 'fs';
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

function runTierSerially(packages) {
  for (const pkg of packages) {
    try {
      execSync('pnpm build:types', { cwd: pkg.dir, stdio: 'inherit' });
    } catch {
      throw new Error(`FAILED: ${pkg.name} build:types`);
    }
  }
}

async function main() {
  const packages = findBuildTypePackages();
  console.log(`Building types for ${packages.length} packages in topological order...\n`);

  const tiers = createBuildTypeTiers(packages);

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const names = tier.map((p) => p.name.replace('@robota-sdk/', '')).join(', ');
    console.log(`Tier ${i + 1}/${tiers.length} [${tier.length} packages]: ${names}`);
    runTierSerially(tier);
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
