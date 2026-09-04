#!/usr/bin/env node

/**
 * Spec-doc frontmatter & ID convention gate (RULE-011).
 *
 * The filename prefix is an initiative/domain namespace; the `type` frontmatter is the orthogonal SDLC
 * classification (one of 11). This guard validates frontmatter VALIDITY (not identity):
 *
 *   Blocking: every `.agents/spec-docs/**.md` (except README.md) has frontmatter with
 *     - `status` ∈ {draft, review-ready, approved, in-progress, verifying, done, rejected}
 *     - `type`   ∈ the 11 SDLC prefixes
 *     - `tags`   present (a non-empty list)
 *   Warning: duplicate `<namespace>-<NNN>` IDs across the tree.
 *
 * `tags` is accepted in every form the toolchain can produce (HARNESS-044): inline `[a, b]`, a
 * prettier-wrapped multi-line flow array (prettier wraps past printWidth, and it is the repo's
 * SSOT formatter), and a YAML block sequence. Reading those forms is NOT this gate's job — it is
 * `frontmatter.mjs`, the harness's single frontmatter parser (HARNESS-046).
 *
 * Recognized OPTIONAL keys (validity not enforced here; extra keys are inert to this gate):
 *   - `completed: <date>` — set at GATE-COMPLETE.
 *   - `capability: true` + `user_execution: agent-run|manual|none` + `user_execution_scenario: <path>` —
 *     the capability-reachability convention (HARNESS-030); enforced by `scan-capability-reachability.mjs`,
 *     which requires a `capability: true` spec in `done/` to name an existing agent-run scenario.
 *
 * Usage: `node scripts/harness/check-spec-doc-frontmatter.mjs [path-to-dir-or-file]`
 * Exit code 0 = clean (warnings allowed), 1 = blocking findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { asList, parseFrontmatterBlock } from './frontmatter.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const SPEC_DIR = path.join(WORKSPACE_ROOT, '.agents/spec-docs');

const STATUSES = new Set([
  'draft',
  'review-ready',
  'approved',
  'in-progress',
  'verifying',
  'done',
  'rejected',
]);
const TYPES = new Set([
  'SCREEN',
  'API',
  'FLOW',
  'BEHAVIOR',
  'DATA',
  'RULE',
  'AGREEMENT',
  'INFRA',
  'PERF',
  'SECURITY',
  'OBSERVABILITY',
]);

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
      out.push(full);
  }
  return out;
}

function frontmatter(text) {
  const entries = parseFrontmatterBlock(text);
  if (!entries) return null;

  const scalar = (key) => (typeof entries.get(key) === 'string' ? entries.get(key) : undefined);
  // A bare scalar (`tags: harness`) counts as a one-item list, as it always has.
  return { status: scalar('status'), type: scalar('type'), tags: asList(entries.get('tags')) };
}

/**
 * How many spec documents the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases, and rewriting them to carry a number proves nothing new (HARNESS-057). RESET at the top of
 * the walk, so a run that reads nothing cannot report the previous run's number.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export function findSpecDocFrontmatterFindings(target) {
  examinedCount = 0;
  const blocking = [];
  const warnings = [];
  const singleFile = target && existsSync(target) && statSync(target).isFile();
  if (!singleFile) {
    // Directory mode only. Measured 2026-08-01: over a root without `.agents/spec-docs` this
    // returned `{blocking: [], warnings: []}` — what it also returns when every document is correct.
    // PROC-006 moves this tree. The single-FILE branch above is deliberately exempt, because that is
    // how the pre-commit path checks one document and its subject is the file, not the tree.
    const dir = target ?? SPEC_DIR;
    requireGovernedTree(path.dirname(dir), [path.basename(dir)], {
      scan: 'spec-doc-frontmatter',
      why: 'The spec-doc tree is the subject; "no findings" over an absent one means "nothing was examined".',
    });
  }
  const files = singleFile ? [target] : walkMarkdown(target ?? SPEC_DIR);
  if (!singleFile && files.length === 0) {
    // An EMPTY tree is the same vacuity as an absent one. `measureFinder` hands a finder a bare temp
    // DIRECTORY, which exists — so "the directory is there" passed while nothing was read.
    throw new Error(
      `spec-doc-frontmatter: no spec documents under ${target ?? SPEC_DIR}. Reporting "no findings" ` +
        'here would mean "nothing was examined", which is not the claim this scan makes.',
    );
  }
  const idMap = new Map();
  for (const file of files) {
    const rel = path.relative(WORKSPACE_ROOT, file);
    examinedCount += 1;
    const fm = frontmatter(readFileSync(file, 'utf8'));
    if (!fm) {
      blocking.push({ file: rel, detail: 'missing frontmatter block' });
      continue;
    }
    if (!fm.status || !STATUSES.has(fm.status))
      blocking.push({
        file: rel,
        detail: `status "${fm.status ?? ''}" not in {${[...STATUSES].join(', ')}}`,
      });
    if (!fm.type || !TYPES.has(fm.type))
      blocking.push({
        file: rel,
        detail: `type "${fm.type ?? ''}" not one of the 11 SDLC prefixes`,
      });
    if (!fm.tags || fm.tags.length === 0)
      blocking.push({ file: rel, detail: 'tags missing or empty' });

    const id = path.basename(file).match(/^([A-Z][A-Z0-9-]*-\d+)/)?.[1];
    if (id) idMap.set(id, (idMap.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idMap) {
    if (count > 1) warnings.push({ file: id, detail: `duplicate spec-doc ID (${count} files)` });
  }
  return { blocking, warnings };
}

export function main(argv = process.argv) {
  const arg = argv[2];
  const target = arg ? path.resolve(WORKSPACE_ROOT, arg) : undefined;
  const { blocking, warnings } = findSpecDocFrontmatterFindings(target);
  for (const w of warnings) process.stdout.write(`- [warn] ${w.file}: ${w.detail}\n`);
  if (blocking.length === 0) {
    process.stdout.write(`::examined:: ${examinedCount} spec documents\n`);
    process.stdout.write('spec-doc frontmatter scan passed.\n');
    return;
  }
  process.stdout.write('spec-doc frontmatter scan failed:\n');
  for (const f of blocking) process.stdout.write(`- [frontmatter] ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
