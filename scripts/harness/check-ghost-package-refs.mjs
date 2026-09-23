#!/usr/bin/env node

/**
 * Check that bare packages/<dir> references in live Markdown resolve to directories.
 *
 * Guard for the "ghost package reference" drift class (architecture audit 2026-06-14,
 * AF-08): live docs (ARCHITECTURE.md, repository-overview.md, …) named packages that
 * no longer exist after renames/removals, and no mechanical scan caught it.
 *
 * Bare `packages/<name>` directory tokens (non-`docs/SPEC.md` docs only) — `<name>`
 *    must be a real directory under `packages/`. Unknown → `ghost-package-path`.
 *    (SPEC.md path tokens are already covered by check-spec-paths — not double-covered here.)
 *
 * check-workspace-refs owns all npm package-name resolution, including Markdown.
 *
 * Exemptions (must not fire): fenced code blocks everywhere; inline code spans everywhere EXCEPT the
 * four front-door documents, where a package name in backticks is the normal way to write one (see
 * FRONT_DOOR_DOCS); documented placeholder names; lines carrying
 * "deliberately absent" vocab; the documented GHOST_PACKAGE_ALLOWLIST; and immutable
 * historical records (CHANGELOGs, closed spec/task/backlog items, frozen versioned
 * content, dated design/plan archives) that faithfully cite now-defunct names.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isImmutableHistoricalRecord } from './check-workspace-refs.mjs';
import { ABSENCE_VOCABULARY } from './cited-paths.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

// Bare `packages/<name>` first-segment directory token. The leading lookbehind rejects
// mid-prose enumerations like "paths/packages/tokens" (where `packages` is preceded by a
// path/word separator, not a real reference boundary).
const PACKAGE_DIR_PATTERN = /(?<![\w/-])packages\/([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/g;

// HARNESS-062: this was a local copy whose own comment admitted the fork ("keeps a local,
// intentionally-narrow copy"). The narrow set it defined is now the SHARED vocabulary in
// cited-paths.mjs — same tokens, one owner — so this guard and the architecture-map guard can no
// longer disagree about whether a sentence exempts itself.

/**
 * Documented intentional references that are NOT live drift. Frozen-baseline precedent:
 * check-orphan-exports.mjs's ORPHAN_EXPORT_ALLOWLIST. Each entry keeps a reason. Only
 * genuine intentional/false-positive tokens belong here — never a real ghost we should fix.
 */
/**
 * Names that stand in for "a package" in a command template, not for a package.
 *
 * Needed only since the front-door span exemption was lifted: `--scope <packages/foo|apps/bar>` is a
 * usage string, and reporting it as a name that does not resolve would be a false accusation about
 * correct prose. Kept tiny and documented, like the allowlist below.
 */
const PLACEHOLDER_NAMES = new Set(['foo', 'bar', 'baz', 'name', 'your-package']);

export const GHOST_PACKAGE_ALLOWLIST = new Set([
  'packages/apps', // `apps` is a sibling workspace family, not a package under packages/ — prose shorthand ("packages/apps") in an agent-definition doc
  // STRUCT-012 S4 retired these source identities. The active spec and Task retain them only to
  // describe the rename; immutable history is excluded separately below.
  ...['gui', 'tui'].map((surface) => `packages/agent-transport-${surface}`),
]);

/**
 * The documents a newcomer reads as the CURRENT description of the repository.
 *
 * These four are read by someone with no way to know a fresher owner exists, so a stale package name
 * in one misleads in a way the same name in a dated record cannot. They are the only docs where an
 * inline code span is scanned rather than exempted.
 */
export const FRONT_DOOR_DOCS = new Set(['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md']);

function listMarkdownFiles(root) {
  const out = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Skip VCS/deps and `.claude` (agent tooling + transient git worktrees under
      // `.claude/worktrees/*`): worktrees are checked-out copies of OTHER branches whose new,
      // not-yet-merged packages do not resolve against develop — walking them yields false
      // ghost-package-ref failures locally (never in CI, which has no worktrees). Not a repo
      // content source for this scan.
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.claude')
        continue;
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
  requireGovernedTree(root, ['packages'], {
    scan: 'ghost-package-refs',
    why: 'A reference is a ghost RELATIVE to the workspace package set; with no packages/ the resolution corpus is empty and every token would resolve to nothing or to everything.',
  });
  const findings = [];
  const packageDirNames = listPackageDirNames(root);

  // ANTI-ROT (HARNESS-052): an allowlisted directory that now exists is stale by construction.
  // npm-name allowlist checks moved with npm-name ownership to check-workspace-refs.
  //
  // Only directory-shaped exemptions live here; npm-name exemptions belong to workspace-refs.
  for (const token of GHOST_PACKAGE_ALLOWLIST) {
    if (packageDirNames.has(token.slice('packages/'.length))) {
      findings.push({
        file: path.relative(root, import.meta.filename),
        type: 'stale-allowlist-entry',
        detail: `${token} is allowlisted as a defunct name but resolves in this workspace. Remove the entry.`,
      });
    }
  }

  for (const docPath of listMarkdownFiles(root)) {
    const rel = path.relative(root, docPath);
    if (isImmutableHistoricalRecord(rel)) continue;
    const isSpec = `${rel.split(path.sep).join('/')}`.endsWith('docs/SPEC.md');

    let inFence = false;
    for (const rawLine of readFileSync(docPath, 'utf8').split('\n')) {
      if (/^\s*(```|~~~)/.test(rawLine)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (ABSENCE_VOCABULARY.test(rawLine)) continue;
      // Inline code spans are stripped everywhere EXCEPT the front door, where a package name in
      // backticks is the normal way to write one and the reader has no way to know it is stale.
      // HARNESS-068 measured the cost: `CONTRIBUTING.md` carried `` `packages/agent-provider` `` —
      // a package the owning document says does not exist — and this scan was silent, not because
      // its scope stopped one file short (it reads every live markdown file) but because the name
      // was in a code span. The exemption was the blind spot, not the file list.
      const line = FRONT_DOOR_DOCS.has(rel) ? rawLine : rawLine.replace(/`[^`]*`/g, ' ');

      if (isSpec) continue; // SPEC.md packages/<name>/** path tokens are check-spec-paths' domain
      for (const match of line.matchAll(PACKAGE_DIR_PATTERN)) {
        const token = match[0];
        if (GHOST_PACKAGE_ALLOWLIST.has(token)) continue;
        if (PLACEHOLDER_NAMES.has(match[1])) continue;
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

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
