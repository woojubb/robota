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
 * SSOT formatter), and a YAML block sequence.
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

const unquote = (s) =>
  s
    .trim()
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim();

/** Split a YAML flow sequence (`[a, b, c]`, possibly already joined from several lines). */
function parseFlowSequence(text) {
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  if (open === -1 || close < open) return undefined;
  return text
    .slice(open + 1, close)
    .split(',')
    .map(unquote)
    .filter((item) => item.length > 0);
}

/**
 * Resolve one key's value from its inline part plus the indented lines beneath it.
 *
 * Handles every form that occurs in this repo's spec-docs:
 *   - scalar            `status: draft`
 *   - inline flow list  `tags: [a, b]`
 *   - wrapped flow list `tags:\n  [\n    a,\n    b,\n  ]`   ← what prettier emits past printWidth
 *   - block sequence    `tags:\n  - a\n  - b`
 */
function resolveValue(inline, continuationLines) {
  const indented = continuationLines.map((line) => line.trim()).filter((line) => line.length > 0);

  if (inline.startsWith('[')) return parseFlowSequence([inline, ...indented].join(' ')) ?? [];
  if (inline.length > 0) return inline;

  if (indented.length === 0) return undefined;
  if (indented[0].startsWith('[')) return parseFlowSequence(indented.join(' ')) ?? [];
  if (indented.every((line) => line.startsWith('-')))
    return indented.map((line) => unquote(line.slice(1))).filter((item) => item.length > 0);

  return indented.join(' ');
}

/**
 * Minimal YAML-frontmatter reader: maps every top-level key to a string (scalar) or
 * string[] (sequence). Deliberately dependency-free — the repo declares no YAML parser.
 */
export function parseFrontmatterBlock(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;

  const lines = text.slice(3, end).split('\n');
  const entries = new Map();
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
    if (!match) continue;

    // Everything indented below the key belongs to this key's value.
    const continuation = [];
    let next = i + 1;
    for (; next < lines.length; next++) {
      if (lines[next].trim() !== '' && !/^\s/.test(lines[next])) break;
      continuation.push(lines[next]);
    }
    entries.set(match[1], resolveValue(match[2].trim(), continuation));
    i = next - 1;
  }
  return entries;
}

function frontmatter(text) {
  const entries = parseFrontmatterBlock(text);
  if (!entries) return null;

  const scalar = (key) => (typeof entries.get(key) === 'string' ? entries.get(key) : undefined);
  const raw = entries.get('tags');
  // A bare scalar (`tags: harness`) counts as a one-item list, as it always has.
  const tags = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : undefined;
  return { status: scalar('status'), type: scalar('type'), tags };
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
