#!/usr/bin/env node

/**
 * SELFHOST-009 TC-01 — hook-catalog drift guard.
 *
 * The documented catalog SSOT (packages/agent-core/docs/HOOK-CATALOG.md) is the product surface for
 * the lifecycle hook events; without a mechanical floor it rots (the guide table had already drifted:
 * a phantom Notification row + 6 omitted events). This scan FAILs on any disagreement between three
 * sources of truth:
 *
 *   1. the THookEvent union     (packages/agent-core/src/hooks/types.ts)
 *   2. the documented catalog   (packages/agent-core/docs/HOOK-CATALOG.md — the Events table)
 *   3. the resolved firing call-sites across the workspace src trees
 *
 * FAIL conditions:
 *   - a THookEvent union member missing from the catalog doc;
 *   - a documented event that is NOT a union member (phantom);
 *   - a documented event with NO resolved firing call-site.
 *
 * Firing-site resolution handles VARIABLE dispatch, not only string literals at runHooks(. Some
 * events never appear as a literal first argument to runHooks — they are dispatched through a
 * variable (SubagentStart/SubagentStop via getSubagentHookEvent; WorktreeCreate/WorktreeRemove via
 * fireWorktreeHook's event param; PreModelCall/PostModelCall via fireModelCallHook's event param). A
 * firing event name is resolved from ANY of:
 *   (a) a string literal passed as the 2nd argument to runHooks(;
 *   (b) a hook_event_name: '<Event>' object-literal field (present at every firing site);
 *   (c) a string literal returned from the getSubagentHookEvent mapping (return '<Event>');
 *   (d) a string literal passed as the 2nd argument to a fire*Hook helper
 *       (fireWorktreeHook / fireModelCallHook).
 *
 * These four cover all 16 events including the six variable-dispatched ones. Equality comparisons
 * such as input.hook_event_name === '<Event>' (agent-core hook-runner) are NOT matched — they have no
 * colon after hook_event_name — so a comparison site cannot mask real firing-site drift.
 *
 * Exit 0 = clean, 1 = drift.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const UNION_FILE = 'packages/agent-core/src/hooks/types.ts';
const CATALOG_DOC = 'packages/agent-core/docs/HOOK-CATALOG.md';

/** Directories whose src trees are scanned for firing call-sites. */
const FIRING_SCAN_DIRS = ['packages'];

/**
 * Extract the THookEvent union member names from the types.ts source. Reads the
 * `export type THookEvent =` declaration up to its terminating `;` and collects the string literals.
 */
export function parseUnionEvents(source) {
  const start = source.indexOf('export type THookEvent');
  if (start === -1) return [];
  const end = source.indexOf(';', start);
  const block = end === -1 ? source.slice(start) : source.slice(start, end);
  const events = [];
  const re = /'([A-Za-z]+)'/g;
  let match;
  while ((match = re.exec(block)) !== null) {
    events.push(match[1]);
  }
  return events;
}

/**
 * Extract the documented event names from the catalog doc's Events table. Only matches table data
 * rows whose first column is a back-ticked event name (`| `Event` |`), so inline prose mentions and
 * the header/separator rows are ignored.
 */
export function parseDocEvents(source) {
  const events = [];
  const re = /^\|\s*`([A-Za-z]+)`\s*\|/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    events.push(match[1]);
  }
  return events;
}

/**
 * Resolve the firing event names present in a single source string, covering literal AND variable
 * dispatch (see the header). Returns the raw captures; the caller intersects with the union to decide
 * which events have a firing site.
 */
export function findFiringEvents(source) {
  const found = new Set();
  const patterns = [
    // (a) runHooks(config, 'Event', ...) — literal 2nd argument (whitespace/newline tolerant).
    /runHooks\(\s*[^,()]+,\s*'([A-Za-z]+)'/g,
    // (b) hook_event_name: 'Event' — object-literal field at a firing site (NOT `=== 'Event'`).
    /hook_event_name:\s*'([A-Za-z]+)'/g,
    // (c) return 'Event' — the getSubagentHookEvent mapping table.
    /return\s+'([A-Za-z]+)'/g,
    // (d) fireWorktreeHook(x, 'Event', ...) / fireModelCallHook(x, 'Event', ...) — fire*Hook helper
    //     call-sites whose 2nd argument is the event-name literal.
    /\bfire[A-Za-z]*\(\s*[^,()]+,\s*'([A-Za-z]+)'/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(source)) !== null) {
      found.add(match[1]);
    }
  }
  return [...found];
}

/**
 * Pure drift computation over the three resolved sets. Exposed so the harness test can drive
 * red→green fixtures (literal- AND variable-dispatched) without touching disk.
 */
export function computeCatalogDrift({ unionEvents, docEvents, firingEvents }) {
  const union = new Set(unionEvents);
  const doc = new Set(docEvents);
  const firing = new Set(firingEvents);
  const findings = [];

  for (const event of union) {
    if (!doc.has(event)) {
      findings.push(`union member \`${event}\` is missing from the catalog doc (${CATALOG_DOC}).`);
    }
  }
  for (const event of doc) {
    if (!union.has(event)) {
      findings.push(
        `documented event \`${event}\` is NOT a THookEvent member (phantom) — remove it or add it to the union.`,
      );
    }
  }
  for (const event of doc) {
    if (union.has(event) && !firing.has(event)) {
      findings.push(
        `documented event \`${event}\` has NO resolved firing call-site — wire it (or remove it if it no longer fires).`,
      );
    }
  }
  return findings;
}

function walkSource(target) {
  const full = path.join(WORKSPACE_ROOT, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return full.endsWith('.ts') ? [full] : [];
  const files = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    // Firing is a property of the SHIPPED source, not test fixtures or build output.
    if (entry.name === '__tests__' || entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSource(child));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      files.push(path.join(WORKSPACE_ROOT, child));
    }
  }
  return files;
}

/** Aggregate the live firing set across the scanned src trees. */
export function collectFiringEvents(root = WORKSPACE_ROOT) {
  const firing = new Set();
  for (const dir of FIRING_SCAN_DIRS) {
    for (const file of walkSource(dir)) {
      if (path.resolve(file) === path.join(root, UNION_FILE)) continue;
      for (const event of findFiringEvents(readFileSync(file, 'utf8'))) {
        firing.add(event);
      }
    }
  }
  return [...firing];
}

export function findHookCatalogFindings(root = WORKSPACE_ROOT) {
  const unionEvents = parseUnionEvents(readFileSync(path.join(root, UNION_FILE), 'utf8'));
  const docEvents = parseDocEvents(readFileSync(path.join(root, CATALOG_DOC), 'utf8'));
  const firingEvents = collectFiringEvents(root);
  return computeCatalogDrift({ unionEvents, docEvents, firingEvents });
}

function main() {
  const findings = findHookCatalogFindings();
  if (findings.length === 0) {
    console.log('hook-catalog scan passed.');
    process.exit(0);
  }
  console.error(
    'hook-catalog scan FAILED — the documented catalog, the THookEvent union, and the firing call-sites disagree:',
  );
  for (const f of findings) {
    console.error(`  - ${f}`);
  }
  console.error(
    `\nKeep ${CATALOG_DOC} (the SSOT), the THookEvent union, and the runHooks firing sites in sync.`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
