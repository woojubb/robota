#!/usr/bin/env node

/**
 * Check that @robota-sdk/* tokens in package.json scripts and helper .mjs
 * scripts resolve to existing workspace packages.
 *
 * Lesson source: the agent-web → agent-web-ui package rename left a stale
 * filter token (old web package name) in agent-cli's build script — develop
 * was locally unbuildable and nothing detected it (HARNESS-004, 2026-06-11).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { listManifestPackageDirs } from './workspace-packages.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

// SSOT for the `@robota-sdk/*` npm-token shape. Exported so sibling doc/package
// guards (e.g. check-ghost-package-refs) validate against the same pattern rather
// than forking the regex.
export const TOKEN_PATTERN = /@robota-sdk\/[a-z0-9]+(?:-[a-z0-9]+)*(?![\w-])/g;

// Example/fixture tokens used inside harness scripts' own rule tables and allowlists.
const EXAMPLE_TOKEN_ALLOWLIST = new Set([
  '@robota-sdk/agent-provider', // removed monolith; remains only as a forbidden-PREFIX literal in check-agent-server-boundary (matches all agent-provider-* leaves)
  '@robota-sdk/other',
  // Defunct-name literals seeded in check-ghost-package-refs' GHOST_PACKAGE_ALLOWLIST.
  '@robota-sdk/dag-nodes',
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listPackageJsonFiles(root) {
  const files = [];
  const rootPkg = path.join(root, 'package.json');
  if (existsSync(rootPkg)) files.push(rootPkg);
  for (const family of ['packages', 'apps']) {
    const familyDir = path.join(root, family);
    if (!existsSync(familyDir)) continue;
    for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(familyDir, entry.name, 'package.json');
      if (existsSync(pkgPath)) files.push(pkgPath);
    }
  }
  return files;
}

function listHelperScripts(root) {
  const results = [];

  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        results.push(full);
      }
    }
  }

  walk(path.join(root, 'scripts'));
  for (const family of ['packages', 'apps']) {
    const familyDir = path.join(root, family);
    if (!existsSync(familyDir)) continue;
    for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      walk(path.join(familyDir, entry.name, 'scripts'));
    }
  }
  return results;
}

/**
 * SSOT for "the set of every workspace package `name`". Exported so sibling
 * doc/package guards (e.g. check-ghost-package-refs) reuse the exact same name
 * set rather than re-deriving their own list.
 *
 * Nesting-aware for `packages/` (via workspace-packages.mjs) so nested-group
 * members like `packages/dag-nodes/<name>` are included — the depth-1
 * `listPackageJsonFiles` script corpus alone would miss them. This can only
 * grow the resolved-name set, so it never adds check-workspace-refs findings.
 */
export function listWorkspacePackageNames(root = WORKSPACE_ROOT) {
  const names = new Set();
  const addName = (pkgPath) => {
    if (!existsSync(pkgPath)) return;
    const name = readJson(pkgPath).name;
    if (typeof name === 'string') names.add(name);
  };
  addName(path.join(root, 'package.json'));
  for (const dir of listManifestPackageDirs(root)) addName(path.join(dir, 'package.json'));
  const appsDir = path.join(root, 'apps');
  if (existsSync(appsDir)) {
    for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) addName(path.join(appsDir, entry.name, 'package.json'));
    }
  }
  return names;
}

export async function findWorkspaceRefFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'workspace-refs',
    why: 'Resolution is relative to the workspace package set; with none, every reference is unresolvable and none is reported.',
  });
  const findings = [];
  const packageJsonFiles = listPackageJsonFiles(root);

  const workspaceNames = listWorkspacePackageNames(root);

  function checkText(text, relativeFile) {
    for (const match of text.matchAll(TOKEN_PATTERN)) {
      const token = match[0];
      if (EXAMPLE_TOKEN_ALLOWLIST.has(token)) continue;
      if (!workspaceNames.has(token)) {
        findings.push({
          file: relativeFile,
          type: 'unresolved-workspace-ref',
          detail: `${token} does not resolve to any workspace package.`,
        });
      }
    }
  }

  // ANTI-ROT (HARNESS-052): an allowlist entry naming a package that DOES resolve is stale by
  // construction — it exempts nothing today and silently exempts a real ghost the day that package
  // is deleted. `@robota-sdk/agent-provider-bytedance` sat here as "not a workspace package" while
  // being one; the entry was inert, and inert is exactly how a suppression survives review.
  for (const token of EXAMPLE_TOKEN_ALLOWLIST) {
    if (workspaceNames.has(token)) {
      findings.push({
        file: path.relative(root, import.meta.filename),
        type: 'stale-allowlist-entry',
        detail: `${token} is allowlisted as a non-workspace token but resolves to a real workspace package. Remove the entry.`,
      });
    }
  }

  examinedManifests = 0;
  for (const pkgPath of packageJsonFiles) {
    examinedManifests++;
    const scripts = readJson(pkgPath).scripts ?? {};
    checkText(Object.values(scripts).join('\n'), path.relative(root, pkgPath));
  }

  examinedHelperScripts = 0;
  for (const scriptPath of listHelperScripts(root)) {
    examinedHelperScripts++;
    checkText(readFileSync(scriptPath, 'utf8'), path.relative(root, scriptPath));
  }

  return findings;
}

/**
 * How much the last run read — HARNESS-057. TWO holders for TWO subjects: this scan reads package
 * manifests (their `scripts` blocks) and the helper scripts under `scripts/`, and one number would
 * have to misreport one of them. Set where each walk happens and read where the lines are printed,
 * so the finder's return shape and its tests stay untouched.
 */
let examinedManifests = 0;
let examinedHelperScripts = 0;

/** What the last run actually read — exported so both counts can be asserted. */
export function examinedManifestCount() {
  return examinedManifests;
}
export function examinedHelperScriptCount() {
  return examinedHelperScripts;
}

export async function main() {
  const findings = await findWorkspaceRefFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    // The size of each subject, on the channel the runner reads. A zero in either means that walk
    // found nothing — a pass over nothing rather than a tree with no stale refs — so neither
    // carries an expected-empty excuse.
    process.stdout.write(`::examined:: ${examinedManifests} package manifests\n`);
    process.stdout.write(`::examined:: ${examinedHelperScripts} helper scripts\n`);
    process.stdout.write('workspace ref scan passed.\n');
    return;
  }
  process.stdout.write('workspace ref scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
