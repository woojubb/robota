#!/usr/bin/env node
/**
 * Runs build:types for all workspace packages in strict topological order.
 * Packages at the same dependency tier run in parallel.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function findPackages() {
  const results = new Map(); // name -> pkg info

  const scanDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(dir, entry.name, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!pkg.name || !pkg.scripts?.['build:types']) continue;
      if (results.has(pkg.name)) continue; // skip duplicates
      results.set(pkg.name, {
        name: pkg.name,
        dir: path.join(dir, entry.name),
        deps: Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@robota-sdk/')),
      });
    }
  };

  scanDir(path.join(root, 'packages'));
  scanDir(path.join(root, 'packages', 'dag-nodes'));

  return [...results.values()];
}

function topoSort(packages) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const tiers = [];
  const built = new Set();

  while (built.size < packages.length) {
    const tier = packages.filter((p) => {
      if (built.has(p.name)) return false;
      return p.deps.every((d) => !byName.has(d) || built.has(d));
    });

    if (tier.length === 0) {
      const remaining = packages.filter((p) => !built.has(p.name));
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

async function runParallel(packages) {
  return Promise.all(
    packages.map(
      (pkg) =>
        new Promise((resolve, reject) => {
          try {
            execSync('pnpm build:types', { cwd: pkg.dir, stdio: 'inherit' });
            resolve();
          } catch (e) {
            reject(new Error(`FAILED: ${pkg.name} build:types`));
          }
        }),
    ),
  );
}

async function main() {
  const packages = findPackages();
  console.log(`Building types for ${packages.length} packages in topological order...\n`);

  const tiers = topoSort(packages);

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const names = tier.map((p) => p.name.replace('@robota-sdk/', '')).join(', ');
    console.log(`Tier ${i + 1}/${tiers.length} [${tier.length} packages]: ${names}`);
    await runParallel(tier);
    console.log(`  ✓ done\n`);
  }

  console.log('✓ All build:types complete.');
}

main().catch((e) => {
  console.error('\n' + e.message);
  process.exit(1);
});
