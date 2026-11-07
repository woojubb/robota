#!/usr/bin/env node

/** Check package metadata needed for safe publication. */

import { readFileSync, existsSync } from 'node:fs';
import path, { join, relative } from 'node:path';

import { listManifestPackageDirs } from './workspace-packages.mjs';

function normalizeRepositoryUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const normalized = value.replace(/^git\+/u, '').replace(/\.git$/u, '').replace(/\/+$/u, '');
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
  } catch {
    return undefined;
  }
}

export function namesThisRepository(repository, expectedRepositoryUrl) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  const actual = normalizeRepositoryUrl(url);
  const expected = normalizeRepositoryUrl(expectedRepositoryUrl);
  return actual !== undefined && expected !== undefined && actual === expected;
}

export function main(root = process.cwd(), expectedRepositoryUrl = process.env.PROJECT_REPOSITORY_URL) {
  let errors = 0;

  function error(msg) {
    console.error(`❌ ${msg}`);
    errors++;
  }

  function ok(msg) {
    console.log(`✅ ${msg}`);
  }

  if (!expectedRepositoryUrl || !normalizeRepositoryUrl(expectedRepositoryUrl)) {
    error('PROJECT_REPOSITORY_URL must be an explicit HTTPS repository URL for publish provenance.');
    return 1;
  }

  const pkgDirs = listManifestPackageDirs(root).map((dir) =>
    relative(root, join(dir, 'package.json')),
  );
  if (!pkgDirs.length) {
    error('No package manifests found');
    return 1;
  }
  let checked = 0;
  let skippedPrivate = 0;
  for (const pkgPath of pkgDirs) {
    const pkg = JSON.parse(readFileSync(join(root, pkgPath), 'utf-8'));
    if (pkg.private) {
      skippedPrivate++;
      continue;
    }
    checked++;

    const hasPrepublish = pkg.scripts?.prepublishOnly?.includes('check-pnpm-publish');
    if (!hasPrepublish) {
      error(`${pkg.name} missing prepublishOnly hook (pnpm publish enforcement)`);
    }
    if (!namesThisRepository(pkg.repository, expectedRepositoryUrl)) {
      error(`${pkg.name} repository.url must match the configured PROJECT_REPOSITORY_URL (provenance)`);
    }
  }
  ok(
    `Checked prepublishOnly hooks and repository on ${checked} publishable package(s) ` +
      `(${skippedPrivate} private package(s) skipped, of ${pkgDirs.length} in the workspace)`,
  );

  if (!existsSync(join(root, 'scripts/check-pnpm-publish.sh'))) {
    error('scripts/check-pnpm-publish.sh not found');
  } else {
    ok('check-pnpm-publish.sh exists');
  }

  // Summary
  console.log(
    `\n${errors === 0 ? '✅ Publish safety check passed' : `❌ ${errors} error(s) found`}`,
  );
  return errors > 0 ? 1 : 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exitCode = main();
}
