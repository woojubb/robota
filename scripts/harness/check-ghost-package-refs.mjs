#!/usr/bin/env node

/**
 * Check that package references in repo Markdown resolve to real workspace packages.
 *
 * Guard for the "ghost package reference" drift class (architecture audit 2026-06-14,
 * AF-08): live docs (ARCHITECTURE.md, repository-overview.md, …) named packages that
 * no longer exist after renames/removals, and no mechanical scan caught it.
 *
 * Two token kinds are validated per doc:
 *  - `@robota-sdk/<name>` npm tokens — must resolve to a workspace package `name`.
 *    Unknown → `ghost-package-ref`.
 *  - bare `packages/<name>` directory tokens (non-`docs/SPEC.md` docs only) — `<name>`
 *    must be a real directory under `packages/`. Unknown → `ghost-package-path`.
 *    (SPEC.md path tokens are already covered by check-spec-paths — not double-covered here.)
 *
 * SSOT reuse: the `@robota-sdk/*` token pattern and the workspace name set come from
 * check-workspace-refs.mjs (no forked regex / package list). check-workspace-refs owns
 * the non-`.md` corpus (package.json scripts + helper .mjs); this guard owns the `.md`
 * corpus — same SSOT, disjoint inputs.
 *
 * Exemptions (must not fire): fenced code blocks and inline code spans; lines carrying
 * "deliberately absent" vocab; the documented GHOST_PACKAGE_ALLOWLIST; and immutable
 * historical records (CHANGELOGs, closed spec/task/backlog items, frozen versioned
 * content, dated design/plan archives) that faithfully cite now-defunct names.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { TOKEN_PATTERN, listWorkspacePackageNames } from './check-workspace-refs.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// Bare `packages/<name>` first-segment directory token. The leading lookbehind rejects
// mid-prose enumerations like "paths/packages/tokens" (where `packages` is preceded by a
// path/word separator, not a real reference boundary).
const PACKAGE_DIR_PATTERN = /(?<![\w/-])packages\/([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g;

// Vocabulary marking a deliberately-absent reference. Mirrors the NEGATION set in
// check-architecture-map-paths.mjs — that module exposes a regex (not a shared Set), so
// this keeps a local, intentionally-narrow copy scoped to the tokens this guard needs.
const ABSENCE_VOCAB = /\(planned\)|\(removed\)|\(deleted\)|\(renamed\)|no longer|does not exist/i;

/**
 * Documented intentional references that are NOT live drift. Frozen-baseline precedent:
 * check-orphan-exports.mjs's ORPHAN_EXPORT_ALLOWLIST. Each entry keeps a reason. Only
 * genuine intentional/false-positive tokens belong here — never a real ghost we should fix.
 */
export const GHOST_PACKAGE_ALLOWLIST = new Set([
  '@robota-sdk/dag-nodes', // group-container README title (packages/dag-nodes holds nested dag-node-* packages); the container itself ships no package
  '@robota-sdk/agent-provider-bytedance', // names a phantom/unused agent-server dependency slated for removal (backlog DEP-001); not a workspace package
  'packages/apps', // `apps` is a sibling workspace family, not a package under packages/ — prose shorthand ("packages/apps") in an agent-definition doc
]);

/** Doc trees that are immutable historical records — a defunct name there is history, not drift. */
function isExcludedDoc(rel) {
  if (path.basename(rel) === 'CHANGELOG.md') return true; // append-only release history (changesets)
  const p = `/${rel.split(path.sep).join('/')}`;
  if (/\/\.changeset\//.test(p)) return true; // pending changelog fragments (same class as CHANGELOG.md; a removal changeset must name the removed package)
  if (/\/\.agents\/spec-docs\/(done|rejected)\//.test(p)) return true; // closed/archived spec work items
  if (/\/\.agents\/tasks\/completed\//.test(p)) return true; // completed task records
  if (/\/\.agents\/backlog\/completed\//.test(p)) return true; // completed backlog items
  if (/\/\.agents\/release-runs\//.test(p)) return true; // frozen per-release run records (immutable history)
  if (/\/content\/v\d/.test(p)) return true; // frozen versioned documentation snapshots
  if (/\/docs\/superpowers\//.test(p)) return true; // dated historical plan/spec artifacts
  if (/\/\.design\//.test(p)) return true; // dated design-review / architecture-audit archive
  return false;
}

function listMarkdownFiles(root) {
  const out = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  }
  walk(root);
  return out;
}

/** First-level directory names under `packages/` (includes nested-group containers). */
function listPackageDirNames(root) {
  const dir = path.join(root, 'packages');
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

export async function findGhostPackageRefFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const workspaceNames = listWorkspacePackageNames(root);
  const packageDirNames = listPackageDirNames(root);

  for (const docPath of listMarkdownFiles(root)) {
    const rel = path.relative(root, docPath);
    if (isExcludedDoc(rel)) continue;
    const isSpec = `${rel.split(path.sep).join('/')}`.endsWith('docs/SPEC.md');

    let inFence = false;
    for (const rawLine of readFileSync(docPath, 'utf8').split('\n')) {
      if (/^\s*(```|~~~)/.test(rawLine)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (ABSENCE_VOCAB.test(rawLine)) continue;
      const line = rawLine.replace(/`[^`]*`/g, ' '); // strip inline code spans

      for (const match of line.matchAll(TOKEN_PATTERN)) {
        const token = match[0];
        if (GHOST_PACKAGE_ALLOWLIST.has(token)) continue;
        if (!workspaceNames.has(token)) {
          findings.push({
            file: rel,
            type: 'ghost-package-ref',
            detail: `${token} does not resolve to any workspace package.`,
          });
        }
      }

      if (isSpec) continue; // SPEC.md packages/<name>/** path tokens are check-spec-paths' domain
      for (const match of line.matchAll(PACKAGE_DIR_PATTERN)) {
        const token = match[0];
        if (GHOST_PACKAGE_ALLOWLIST.has(token)) continue;
        if (!packageDirNames.has(match[1])) {
          findings.push({
            file: rel,
            type: 'ghost-package-path',
            detail: `${token} does not resolve to any packages/ directory.`,
          });
        }
      }
    }
  }
  return findings;
}

export async function main() {
  const findings = await findGhostPackageRefFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('ghost package ref scan passed.\n');
    return;
  }
  process.stdout.write('ghost package ref scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
