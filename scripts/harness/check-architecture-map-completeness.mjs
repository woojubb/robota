#!/usr/bin/env node

/**
 * Architecture-map STRUCTURE completeness gate (RULE-008).
 *
 * Distinct axis from `check-architecture-map-paths.mjs` (which owns SOURCE INTEGRITY — cited
 * `packages/<name>` paths must resolve). This guard owns STRUCTURE: every non-exempt architecture-map
 * doc must carry the required spine defined by the architecture-map document-type contract.
 *
 *   MUST (blocking):
 *     - an H1 title
 *     - a scope line (a prose paragraph after the H1, before the first `##`, other than the up-link)
 *     - an up-link: a link to `ARCHITECTURE-MAP.md` OR to another doc inside the architecture-map tree
 *       (top-level docs route to the root map; nested detail docs route to their parent router)
 *     - a structure block: a markdown table, a ```mermaid diagram, OR (for a router doc) >= 2 links to
 *       other architecture-map docs (the routing list IS the router's structure)
 *   SHOULD (warning, non-blocking):
 *     - owner pointers — at least one link to an owning SPEC / spec doc
 *
 * Exempt subtypes (logs / index, not relationship maps): README.md, architecture-lessons.md,
 * layering-audit.md.
 *
 * Path existence is NOT re-checked here — delegated to `check-architecture-map-paths.mjs`.
 *
 * Usage: `node scripts/harness/check-architecture-map-completeness.mjs [path-to-dir-or-file]`
 * Exit code 0 = clean (warnings allowed), 1 = blocking findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const MAP_DIR = path.join(WORKSPACE_ROOT, '.agents/specs/architecture-map');
const SKIP_FILES = new Set(['README.md', 'architecture-lessons.md', 'layering-audit.md']);

const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const OWNER_POINTER = /\]\([^)]*(?:SPEC\.md|\/docs\/|spec-docs\/)[^)]*\)/;

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Classify a doc's markdown links relative to its own directory. */
function classifyLinks(filePath, text) {
  const dir = path.dirname(filePath);
  let intraMapMd = 0;
  let hasRootMapLink = false;
  for (const m of text.matchAll(LINK)) {
    const raw = m[1].trim().split('#')[0];
    if (!raw || /^(https?:|mailto:)/i.test(raw)) continue;
    if (/ARCHITECTURE-MAP\.md$/.test(raw)) hasRootMapLink = true;
    const resolved = path.resolve(dir, raw);
    if (resolved === filePath) continue; // self
    if (resolved.startsWith(MAP_DIR + path.sep) && resolved.endsWith('.md')) intraMapMd += 1;
  }
  return { intraMapMd, hasRootMapLink };
}

function analyze(filePath, lines) {
  const blocking = [];
  const warnings = [];
  const text = lines.join('\n');
  const { intraMapMd, hasRootMapLink } = classifyLinks(filePath, text);

  const h1Idx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (h1Idx === -1) blocking.push('missing H1 title');

  if (h1Idx !== -1) {
    let hasScope = false;
    let inFence = false;
    for (let i = h1Idx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s/.test(line)) break;
      if (/^```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const t = line.trim();
      if (!t) continue;
      if (/ARCHITECTURE-MAP\.md\)/.test(line)) continue; // a bare up-link is not the scope line
      hasScope = true;
      break;
    }
    if (!hasScope) blocking.push('missing scope line (a prose paragraph after the H1)');
  }

  if (!hasRootMapLink && intraMapMd < 1) {
    blocking.push('missing up-link (to ../ARCHITECTURE-MAP.md or a parent/sibling map doc)');
  }

  const hasTable = lines.some(
    (l, i) => /^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? ''),
  );
  const hasMermaid = /```mermaid/.test(text);
  const isRouter = intraMapMd >= 2;
  if (!hasTable && !hasMermaid && !isRouter) {
    blocking.push('missing structure block (a table, a ```mermaid diagram, or a router link-list)');
  }

  if (!OWNER_POINTER.test(text)) {
    warnings.push('no owner pointer (link to an owning SPEC / spec doc) — recommended');
  }
  return { blocking, warnings };
}

export function findArchitectureMapCompletenessFindings(target = MAP_DIR) {
  const blocking = [];
  const warnings = [];
  const files = existsSync(target) && statSync(target).isFile() ? [target] : walkMarkdown(target);
  for (const file of files) {
    if (SKIP_FILES.has(path.basename(file))) continue;
    const rel = path.relative(WORKSPACE_ROOT, file);
    const { blocking: b, warnings: w } = analyze(file, readFileSync(file, 'utf8').split('\n'));
    for (const m of b) blocking.push({ file: rel, detail: m });
    for (const m of w) warnings.push({ file: rel, detail: m });
  }
  return { blocking, warnings };
}

export function main(argv = process.argv) {
  const arg = argv[2];
  const target = arg ? path.resolve(WORKSPACE_ROOT, arg) : MAP_DIR;
  const { blocking, warnings } = findArchitectureMapCompletenessFindings(target);
  for (const w of warnings) process.stdout.write(`- [warn] ${w.file}: ${w.detail}\n`);
  if (blocking.length === 0) {
    process.stdout.write('architecture-map completeness scan passed.\n');
    return;
  }
  process.stdout.write('architecture-map completeness scan failed:\n');
  for (const f of blocking) process.stdout.write(`- [missing-spine] ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
