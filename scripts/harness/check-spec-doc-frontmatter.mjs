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

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
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
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  const get = (key) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : undefined;
  };
  return { status: get('status'), type: get('type'), tags: get('tags') };
}

export function findSpecDocFrontmatterFindings(target) {
  const blocking = [];
  const warnings = [];
  const files =
    target && existsSync(target) && statSync(target).isFile()
      ? [target]
      : walkMarkdown(target ?? SPEC_DIR);
  const idMap = new Map();
  for (const file of files) {
    const rel = path.relative(WORKSPACE_ROOT, file);
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
    if (!fm.tags || !/\S/.test(fm.tags.replace(/[[\]]/g, '')))
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
    process.stdout.write('spec-doc frontmatter scan passed.\n');
    return;
  }
  process.stdout.write('spec-doc frontmatter scan failed:\n');
  for (const f of blocking) process.stdout.write(`- [frontmatter] ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
