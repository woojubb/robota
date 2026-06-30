#!/usr/bin/env node

/**
 * Guard against a recurring defect class: build/CI tooling that enumerates workspace packages with a
 * one-level `packages/*` glob silently omits NESTED package groups declared in pnpm-workspace.yaml
 * (e.g. `packages/<group>/*`). The omitted packages' build output goes missing on consuming jobs —
 * the exact gap that broke the CI `package-dist` artifact for `packages/dag-nodes/*` (a consumer
 * then failed to resolve `@robota-sdk/dag-node-*` from a built package).
 *
 * Invariant (domain-free; nested groups derived from pnpm-workspace.yaml, never hardcoded):
 *   For every nested package group `packages/<g>/<star>` in pnpm-workspace.yaml, any GitHub workflow
 *   that globs the one-level package dist set MUST also glob the nested group's dist set
 *   (`packages/<g>/<star>/dist`). `<star>` denotes the literal `*` wildcard.
 *
 * Why this exists as a check, not just a rule: the same one-level-glob omission recurred across
 * multiple build/CI surfaces in a single change and was fixed reactively, one CI failure at a time.
 * This scan makes a future omission fail loudly. See `.agents/rules/learning-loop.md`
 * ("fix the class, not the instance" / "build the mechanism").
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();
const WORKFLOWS_DIR = '.github/workflows';
/** A one-level package dist glob (the pattern that omits nested groups). */
const ONE_LEVEL_DIST_GLOB = 'packages/*/dist';

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nested package groups = pnpm-workspace globs of the shape `packages/<group>/*` (two segments before
 * the wildcard). `packages/*` (one segment) is not a nested group.
 */
async function readNestedGroupDirs(root) {
  const yamlPath = path.join(root, 'pnpm-workspace.yaml');
  if (!(await pathExists(yamlPath))) return [];
  const yaml = await fs.readFile(yamlPath, 'utf8');
  const groups = [];
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.trim().replace(/^-\s*/, '').replace(/['"]/g, '');
    const match = line.match(/^(packages\/[^/*\s]+)\/\*$/);
    if (match) groups.push(match[1]); // e.g. "packages/dag-nodes"
  }
  return groups;
}

export async function findNestedGlobCoverageFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const groups = await readNestedGroupDirs(root);
  if (groups.length === 0) return findings;

  const workflowsDir = path.join(root, WORKFLOWS_DIR);
  if (!(await pathExists(workflowsDir))) return findings;

  for (const entry of await fs.readdir(workflowsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
    const relativePath = `${WORKFLOWS_DIR}/${entry.name}`;
    const content = await fs.readFile(path.join(workflowsDir, entry.name), 'utf8');
    if (!content.includes(ONE_LEVEL_DIST_GLOB)) continue;

    for (const group of groups) {
      const requiredGlob = `${group}/*/dist`;
      if (!content.includes(requiredGlob)) {
        findings.push({
          file: relativePath,
          type: 'nested-group-dist-glob-missing',
          detail: `globs '${ONE_LEVEL_DIST_GLOB}' but omits the nested package group '${requiredGlob}' (declared as '${group}/*' in pnpm-workspace.yaml). Built output for that group will be missing from this artifact.`,
        });
      }
    }
  }
  return findings;
}

export async function main() {
  const findings = await findNestedGlobCoverageFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('nested package-group glob coverage scan passed.\n');
    return;
  }
  process.stdout.write('nested package-group glob coverage scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
