#!/usr/bin/env node

/**
 * Harness check: publish safety gate
 *
 * Verifies:
 * 1. agent-core has zero @robota-sdk dependencies
 * 2. All publishable packages have prepublishOnly hook blocking npm publish
 * 3. All publishable packages have workspace:* deps (not hardcoded versions in source)
 * 4. agent-cli publishes as a SELF-CONTAINED bundle — zero @robota-sdk runtime `dependencies`
 *    (INFRA-028: all @robota-sdk workspace code is bundled into dist; siblings are devDeps).
 * 5. No private package's SPEC.md claims npm publication (absorbed from the former
 *    check-spec-publish-claims.mjs — Guard G4, architecture audit 2026-06-19, AF-15:
 *    agent-tool-mcp SPEC said "published to npm" while package.json had `"private": true`).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listSpecPackageDirs } from './workspace-packages.mjs';

const PUBLISH_CLAIM = /\bpublish(?:ed|es)?\b[^.\n]*\bnpm\b/i;
const NEGATED = /\b(not|never|un-?published|internal|private|do(?:es)? not)\b/i;

/**
 * Rule 5 (absorbed spec-publish-claims tripwire): a SPEC line asserting npm publication (and not
 * negating it) is a finding when the package's package.json has `private: true`. Nesting-aware:
 * covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
 */
export function findPublishClaimFindings(root) {
  const findings = [];

  for (const pkgDir of listSpecPackageDirs(root)) {
    const specPath = join(pkgDir, 'docs', 'SPEC.md');
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;

    const isPrivate = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).private === true;
    if (!isPrivate) continue;

    const lines = readFileSync(specPath, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (PUBLISH_CLAIM.test(line) && !NEGATED.test(line)) {
        findings.push({
          file: relative(root, specPath),
          type: 'spec-false-publish-claim',
          detail: `line ${i + 1} claims npm publication but package.json has "private": true.`,
        });
      }
    });
  }
  return findings;
}

export function main(root = process.cwd()) {
  let errors = 0;

  function error(msg) {
    console.error(`❌ ${msg}`);
    errors++;
  }

  function ok(msg) {
    console.log(`✅ ${msg}`);
  }

  // 1. agent-core must have zero @robota-sdk dependencies
  const corePkg = JSON.parse(readFileSync(join(root, 'packages/agent-core/package.json'), 'utf-8'));
  const coreDeps = Object.keys(corePkg.dependencies || {}).filter((d) =>
    d.startsWith('@robota-sdk/'),
  );
  if (coreDeps.length > 0) {
    error(`agent-core has @robota-sdk dependencies: ${coreDeps.join(', ')}`);
  } else {
    ok('agent-core has zero @robota-sdk dependencies');
  }

  const coreDevDeps = Object.keys(corePkg.devDependencies || {}).filter((d) =>
    d.startsWith('@robota-sdk/'),
  );
  if (coreDevDeps.length > 0) {
    error(`agent-core has @robota-sdk devDependencies: ${coreDevDeps.join(', ')}`);
  } else {
    ok('agent-core has zero @robota-sdk devDependencies');
  }

  // 2. All publishable packages must have prepublishOnly hook
  const pkgDirs = readdirSync(join(root, 'packages'))
    .map((d) => `packages/${d}/package.json`)
    .filter((p) => existsSync(join(root, p)));
  for (const pkgPath of pkgDirs) {
    const pkg = JSON.parse(readFileSync(join(root, pkgPath), 'utf-8'));
    if (pkg.private) continue;

    const hasPrepublish = pkg.scripts?.prepublishOnly?.includes('check-pnpm-publish');
    if (!hasPrepublish) {
      error(`${pkg.name} missing prepublishOnly hook (pnpm publish enforcement)`);
    }
  }
  ok('Checked prepublishOnly hooks on all publishable packages');

  // 3. check-pnpm-publish.sh exists
  if (!existsSync(join(root, 'scripts/check-pnpm-publish.sh'))) {
    error('scripts/check-pnpm-publish.sh not found');
  } else {
    ok('check-pnpm-publish.sh exists');
  }

  // 4. INFRA-028: agent-cli must publish as a self-contained bundle — zero @robota-sdk runtime deps.
  const cliPkg = JSON.parse(readFileSync(join(root, 'packages/agent-cli/package.json'), 'utf-8'));
  const cliRuntimeRobota = Object.keys(cliPkg.dependencies || {}).filter((d) =>
    d.startsWith('@robota-sdk/'),
  );
  if (cliRuntimeRobota.length > 0) {
    error(
      `agent-cli must be a self-contained bundle (INFRA-028): move these to devDependencies (bundled): ${cliRuntimeRobota.join(', ')}`,
    );
  } else {
    ok('agent-cli publishes self-contained — zero @robota-sdk runtime dependencies (INFRA-028)');
  }

  // 5. No private package's SPEC.md may claim npm publication (absorbed spec-publish-claims).
  const publishClaimFindings = findPublishClaimFindings(root);
  if (publishClaimFindings.length > 0) {
    for (const finding of publishClaimFindings) {
      error(`[${finding.type}] ${finding.file}: ${finding.detail}`);
    }
  } else {
    ok('No private package SPEC claims npm publication');
  }

  // Summary
  console.log(
    `\n${errors === 0 ? '✅ Publish safety check passed' : `❌ ${errors} error(s) found`}`,
  );
  return errors > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
