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
 *   3. the user guide table     (content/guide/permissions-and-hooks.md — the Event/Timing table)
 *   4. the resolved firing call-sites across the workspace src trees
 *
 * FAIL conditions:
 *   - a THookEvent union member missing from the catalog doc, or from the user guide table;
 *   - a documented (catalog or guide) event that is NOT a union member (phantom);
 *   - a documented event with NO resolved firing call-site.
 *
 * Firing-site resolution handles VARIABLE dispatch, not only string literals at runHooks(. Some
 * events never appear as a literal first argument to runHooks — they are dispatched through a
 * variable (SubagentStart/SubagentStop via getSubagentHookEvent; WorktreeCreate/WorktreeRemove via
 * fireWorktreeHook's event param; PreModelCall/PostModelCall via fireModelCallHook's event param). A
 * firing event name is resolved from ANY of:
 *   (a) a string literal passed as the 2nd argument to runHooks(;
 *   (b) a hook_event_name: '<Event>' object-literal field (present at every firing site);
 *   (c) a string literal returned from WITHIN the getSubagentHookEvent mapping function body
 *       (return '<Event>') — HARNESS-031: scoped to that function so a stray `return '<Event>'` in an
 *       unrelated file cannot satisfy the firing check and mask real firing-site drift;
 *   (d) a string literal passed as the 2nd argument to a fire*Hook helper
 *       (fireWorktreeHook / fireModelCallHook).
 *
 * These four cover all 16 events including the six variable-dispatched ones. Equality comparisons
 * such as input.hook_event_name === '<Event>' (agent-core hook-runner) are NOT matched — they have no
 * colon after hook_event_name — so a comparison site cannot mask real firing-site drift.
 *
 * HARNESS-031 also extended coverage to the user guide's Event/Timing table (a second rot-prone surface
 * that had drifted before SELFHOST-009): its event set must match the union, exactly as the catalog does.
 *
 * Exit 0 = clean, 1 = drift.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const UNION_FILE = 'packages/agent-core/src/hooks/types.ts';
const CATALOG_DOC = 'packages/agent-core/docs/HOOK-CATALOG.md';
const GUIDE_DOC = 'content/guide/permissions-and-hooks.md';

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
 * Extract the `{ ... }` body of a named `function <fnName>` via brace matching, or '' if absent.
 * Brace-counting is imprecise around braces inside strings/comments, but the target (getSubagentHookEvent)
 * is a plain switch/return mapping table, so this is exact for the firing-scope use here (HARNESS-031).
 */
export function extractFunctionBody(source, fnName) {
  const decl = source.search(new RegExp(`function\\s+${fnName}\\b`));
  if (decl === -1) return '';
  const open = source.indexOf('{', decl);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
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
  // (c) HARNESS-031: `return 'Event'` counts ONLY inside the getSubagentHookEvent mapping function body,
  //     so a stray `return '<Event>'` elsewhere cannot masquerade as a firing site and hide real drift.
  const mappingBody = extractFunctionBody(source, 'getSubagentHookEvent');
  if (mappingBody) {
    const re = /return\s+'([A-Za-z]+)'/g;
    let match;
    while ((match = re.exec(mappingBody)) !== null) {
      found.add(match[1]);
    }
  }
  return [...found];
}

/**
 * Extract the event names from the user guide's Event/Timing table (HARNESS-031). The guide holds a
 * SECOND back-ticked-first-column table (the permission-MODE table: `plan`/`default`/…), so match ONLY
 * the hook-events table — identified by its `| Event | Timing | …` header — and collect its data rows
 * until the table ends. This keeps the permission-mode rows out of the event set (no false phantoms).
 */
export function parseGuideEventTable(source) {
  const lines = source.split('\n');
  const events = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*Event\s*\|/.test(line) && /Timing/.test(line)) inTable = true;
      continue;
    }
    if (/^\|\s*-+/.test(line)) continue; // the header separator row
    const m = /^\|\s*`([A-Za-z]+)`\s*\|/.exec(line);
    if (m) {
      events.push(m[1]);
      continue;
    }
    inTable = false; // first non-separator, non-event-row line ends the table
  }
  return events;
}

/**
 * Pure drift computation over the resolved sets. `guideEvents` is OPTIONAL (HARNESS-031): when a
 * `null`/`undefined` is passed, the guide-parity legs are skipped (keeps the disk-free unit fixtures
 * focused on the union/catalog/firing legs). Exposed so the harness test can drive red→green fixtures.
 */
export function computeCatalogDrift({ unionEvents, docEvents, firingEvents, guideEvents = null }) {
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
  if (guideEvents !== null && guideEvents !== undefined) {
    const guide = new Set(guideEvents);
    for (const event of union) {
      if (!guide.has(event)) {
        findings.push(
          `union member \`${event}\` is missing from the user guide table (${GUIDE_DOC}).`,
        );
      }
    }
    for (const event of guide) {
      if (!union.has(event)) {
        findings.push(
          `guide event \`${event}\` is NOT a THookEvent member (phantom) — remove it from ${GUIDE_DOC} or add it to the union.`,
        );
      }
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
  // HARNESS-031: the user guide is a second doc surface (missing ⇒ skip its parity legs, not a hard error).
  const guidePath = path.join(root, GUIDE_DOC);
  const guideEvents = existsSync(guidePath)
    ? parseGuideEventTable(readFileSync(guidePath, 'utf8'))
    : null;
  return computeCatalogDrift({ unionEvents, docEvents, firingEvents, guideEvents });
}

function main() {
  const findings = findHookCatalogFindings();
  if (findings.length === 0) {
    console.log('hook-catalog scan passed.');
    process.exit(0);
  }
  console.error(
    'hook-catalog scan FAILED — the THookEvent union, the catalog doc, the user guide table, and the firing call-sites disagree:',
  );
  for (const f of findings) {
    console.error(`  - ${f}`);
  }
  console.error(
    `\nKeep ${CATALOG_DOC} (the SSOT), the ${GUIDE_DOC} table, the THookEvent union, and the runHooks firing sites in sync.`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
