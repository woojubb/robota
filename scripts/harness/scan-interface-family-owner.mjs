#!/usr/bin/env node
// ARCH-100 (issue #2080) — the contract-family owner map and the acyclic target graph.
//
// The MAP IS NOT IN THIS FILE. `.agents/specs/contract-family-owner-map.md` owns it as a
// human-readable table, and this scan PARSES that table. (`.agents/project-structure.md` routes to
// that spec rather than inlining it — a routing document routes, and `routing-document-size` says so.) A second copy here is the drift this repo
// keeps paying for: `spec-sections.mjs` parses its SSOT out of `spec-writing-standard/SKILL.md` for
// exactly this reason, and the owner map is the same shape of fact.
//
// Three conditions, all of which fail the gate:
//   1. ASSIGNMENT — a contract module of `agent-interface-transport` is unassigned, or assigned to
//      more than one owner. (Total, one-to-one. TC-01.)
//   2. ACYCLICITY — the package graph implied by projecting the real import edges onto the owner map
//      is not acyclic. (TC-02.)
//   3. PLACEMENT — an `agent-interface-*` package holds a module it does not own. Inert until the
//      migration leaves (issues #2108-#2113) begin to move families; it is the condition that keeps
//      the map honest once they do.
//
// Today every module still lives in `agent-interface-transport`, so (3) passes trivially and (1)+(2)
// verify the PLAN against the real source. The scan is the reason the plan cannot rot between now and
// the last migration leaf.
//
// ## What it parses, and what it therefore cannot see (HARNESS-116)
//
// Edges are read from RELATIVE import/export statements by pattern, not by parsing TypeScript. The
// forms it recognises are exactly:
//
//   import        { A } from './x'      export        { A } from './x'
//   import type   { A } from './x'      export type   { A } from './x'
//   import * as n from './x'            export *      from './x'
//
// with the specifier ending in `.js`, `.ts`, `.mjs`, `.mts`, or no extension. A DEFAULT import
// (`import A from './x'`), a bare side-effect import (`import './x'`), a dynamic `import('./x')`, and
// a non-relative specifier are all OUTSIDE that set and are invisible to this scan.
//
// That limit is stated because it is the scan's live failure mode rather than a hypothetical one: a
// gate cannot tell "there is no edge" from "there is an edge I could not parse", and BOTH of this
// scan's defects to date have been exactly that. The first shipped matching only `import … from
// './x.js'` and was blind to 33% of the real edges; the second kept a brace requirement and was blind
// to `export *`. An AST parse (`ts.createSourceFile`) would remove the enumeration problem instead of
// shrinking it, and was rejected on cost — see the HARNESS-116 spec-doc, Alternative B. If a form
// outside the list above ever appears in a package this scan reads, the fix is that parse, not
// another pattern.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULE_DOC = path.join(ROOT, '.agents/specs/contract-family-owner-map.md');
const SOURCE_PKG = path.join(ROOT, 'packages/agent-interface-transport/src');
const MARKER = '<!-- arch-100:owner-map -->';

// Corrections issue #2080 established as PRECONDITIONS of the leaves that need them. Each is applied
// to the projection below, because the target graph is acyclic only once they land. Delete an entry
// when its leaf has applied it for real — at that point the raw source already agrees.
const PENDING_CORRECTIONS = [
  {
    leaf: 'issue #2109',
    from: 'workspace-contracts',
    to: 'session-contracts',
    symbol: 'IBackgroundJobGroupState',
    redirect: 'background-group-contracts',
    why: 'pass-through re-export; the type is declared in background-group-contracts',
  },
];

/**
 * Parse the owner-map table out of the rule document. PURE over the document text so the parser is
 * testable without a repository on disk.
 * @returns {{moduleOwner: Map<string,string>, symbolOwner: Map<string,string>, owners: Set<string>, duplicates: string[]}}
 */
export function parseOwnerMap(docText) {
  const moduleOwner = new Map();
  const symbolOwner = new Map();
  const owners = new Set();
  const duplicates = [];
  const at = docText.indexOf(MARKER);
  if (at === -1) return { moduleOwner, symbolOwner, owners, duplicates, missingMarker: true };
  // Bounded to the ONE table that follows the marker. An unbounded scan of the rest of the document
  // fails OPEN: a later example row — a format being documented, not a claim — would be absorbed as
  // a real assignment and nothing would say so. Once rows have started, the first non-table line ends
  // the table.
  let started = false;
  for (const line of docText.slice(at).split('\n')) {
    const isTableRow = /^\s*\|/.test(line);
    if (started && !isTableRow) break;
    if (isTableRow) started = true;
    const m = line.match(/^\|\s*`(agent-interface-[a-z-]+)`\s*\|(.+?)\|/);
    if (!m) continue;
    const [, owner, cell] = m;
    owners.add(owner);
    const symbolCell = cell.match(/symbols@`([a-z-]+)`\s*:\s*(.+)$/);
    if (symbolCell) {
      for (const sym of symbolCell[2].matchAll(/`([A-Za-z_$][\w$]*)`/g))
        symbolOwner.set(sym[1], owner);
      continue;
    }
    for (const mod of cell.matchAll(/`([a-z][a-z-]*)`/g)) {
      if (moduleOwner.has(mod[1])) {
        duplicates.push(
          `ASSIGNMENT: module \`${mod[1]}\` is assigned to more than one owner (\`${moduleOwner.get(mod[1])}\` and \`${owner}\`).`,
        );
      }
      moduleOwner.set(mod[1], owner);
    }
  }
  return { moduleOwner, symbolOwner, owners, duplicates, missingMarker: false };
}

/**
 * Project intra-package import edges onto owner packages.
 * PURE: `sources` is a plain {module: sourceText} map, so no filesystem is required.
 */
export function projectGraph(sources, moduleOwner, symbolOwner, corrections = []) {
  const edges = new Map();
  const addEdge = (a, b, why) => {
    if (!a || !b || a === b) return;
    if (!edges.has(a)) edges.set(a, new Map());
    if (!edges.get(a).has(b)) edges.get(a).set(b, new Set());
    edges.get(a).get(b).add(why);
  };
  for (const [mod, src] of Object.entries(sources)) {
    // Matches BOTH keywords and every extension spelling. Narrower forms were a real defect: the
    // original matched only `import ... from './x.js'`, so five extension-less relative imports in
    // the package this scan polices were dropped from the graph silently, and a re-export
    // (`export { x } from './y'`) -- a dependency edge just as much as an import -- was invisible
    // for the same reason. The ACYCLICITY verdict survived only because each missed edge happened to
    // have a `.js` twin pointing at the same owner: a coincidence, not a property. That is the
    // unfalsifiable green this scan exists to refuse elsewhere. (MUST finding, PR #2176.)
    // BRACELESS forms carry an edge too, and the named-binding pattern above requires braces, so it
    // cannot see them at all. `export * from './x'` re-exports everything the target declares;
    // `import * as ns from './x'` binds it under a namespace. Neither names a symbol, so the edge
    // resolves to the TARGET MODULE's owner rather than through `symbolOwner`.
    //
    // Only one exists today and it is in `index.ts`, which is out of the graph by design (the barrel
    // is not a contract module and has no owner). Handled anyway: the next `export * from './x'`
    // between two owners would otherwise drop a real edge silently, and "the gate cannot tell 'no
    // edge' from 'an edge I cannot parse'" is the defect this scan already had once.
    for (const bare of src.matchAll(
      /(?:export\s+\*|import\s+\*\s+as\s+[A-Za-z_$][\w$]*)\s+from\s*'\.\/([a-z-]+)(?:\.m?[jt]s)?'/gms,
    )) {
      const target = bare[1];
      const corr = corrections.find((c) => c.from === mod && c.to === target && c.symbol === '*');
      addEdge(
        moduleOwner.get(mod),
        moduleOwner.get(corr ? corr.redirect : target),
        `* (${mod} → ${target})`,
      );
    }
    for (const imp of src.matchAll(
      /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'\.\/([a-z-]+)(?:\.m?[jt]s)?'/gms,
    )) {
      const targetModule = imp[2];
      for (const raw of imp[1].split(',')) {
        const sym = raw
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (!sym || !/^[A-Za-z_$][\w$]*$/.test(sym)) continue;
        const corr = corrections.find(
          (c) => c.from === mod && c.to === targetModule && c.symbol === sym,
        );
        const resolved = corr ? corr.redirect : targetModule;
        const to = symbolOwner.get(sym) ?? moduleOwner.get(resolved);
        addEdge(
          moduleOwner.get(mod),
          to,
          `${sym} (${mod} → ${symbolOwner.has(sym) ? 'extracted' : resolved})`,
        );
      }
    }
  }
  return edges;
}

/** All elementary cycles in an owner graph. PURE. */
export function findCycles(edges, owners) {
  const cycles = [];
  const seen = new Set();
  const walk = (start, node, trail, onPath) => {
    for (const next of edges.get(node)?.keys() ?? []) {
      if (next === start) {
        const key = [...trail].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...trail, start]);
        }
      } else if (!onPath.has(next)) {
        onPath.add(next);
        walk(start, next, [...trail, next], onPath);
        onPath.delete(next);
      }
    }
  };
  for (const o of [...owners].sort()) walk(o, o, [o], new Set([o]));
  return cycles;
}

/** Extraction waves: owners with no outbound edge to a still-unmigrated owner come first. PURE. */
export function migrationWaves(edges, owners) {
  const remaining = new Set(owners);
  const out = [];
  while (remaining.size) {
    const layer = [...remaining].filter(
      (p) => ![...(edges.get(p)?.keys() ?? [])].some((t) => remaining.has(t) && t !== p),
    );
    if (!layer.length) {
      out.push([...remaining]);
      break;
    }
    out.push(layer.sort());
    layer.forEach((p) => remaining.delete(p));
  }
  return out;
}

/**
 * The contract modules this scan examines. PURE over a directory, so a test can point it at a
 * fixture of known size.
 */
export function findContractModules(srcDir = SOURCE_PKG) {
  return readdirSync(srcDir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

/**
 * Exported so a test can read the size this scan reports (`measurement-provenance.md`). A counter is
 * an output and is tested as one: an exact value against a fixture of known size, asserted again
 * after a second run so an accumulating counter is told apart from a growing subject.
 */
export function readExaminedModuleCount(srcDir = SOURCE_PKG) {
  return findContractModules(srcDir).length;
}

function main() {
  const fail = [];
  const note = [];

  if (!existsSync(RULE_DOC)) {
    console.error(`interface-family-owner: cannot read ${path.relative(ROOT, RULE_DOC)}`);
    process.exit(1);
  }
  const parsed = parseOwnerMap(readFileSync(RULE_DOC, 'utf8'));
  if (parsed.missingMarker) {
    console.error(
      `interface-family-owner: ${path.relative(ROOT, RULE_DOC)} has no ${MARKER} marker.\n` +
        '  The owner map is the SSOT this scan reads; without the marker there is nothing to check,\n' +
        '  and a scan that passes because it found no input is the failure mode it exists to prevent.',
    );
    process.exit(1);
  }
  const { moduleOwner, symbolOwner, owners } = parsed;
  fail.push(...parsed.duplicates);

  if (moduleOwner.size === 0) {
    console.error(
      'interface-family-owner: the owner-map table parsed to zero modules. Refusing to pass on an empty read.',
    );
    process.exit(1);
  }

  // ASSIGNMENT — every contract module is assigned exactly once.
  const modules = findContractModules();
  for (const mod of modules) {
    if (!moduleOwner.has(mod))
      fail.push(`ASSIGNMENT: contract module \`${mod}\` has no owner in the map.`);
  }
  for (const mod of moduleOwner.keys()) {
    if (!modules.includes(mod)) {
      note.push(
        `the map assigns \`${mod}\`, which no longer exists in agent-interface-transport/src (already migrated, or renamed).`,
      );
    }
  }

  // ACYCLICITY — project the real import edges onto the owner map.
  const sources = Object.fromEntries(
    modules.map((m) => [m, readFileSync(path.join(SOURCE_PKG, `${m}.ts`), 'utf8')]),
  );
  const edges = projectGraph(sources, moduleOwner, symbolOwner, PENDING_CORRECTIONS);
  for (const c of findCycles(edges, owners)) {
    fail.push(`ACYCLICITY: the projected package graph has a cycle — ${c.join(' → ')}`);
  }

  // PLACEMENT — a module is misplaced only once its declared owner package actually exists. Before
  // that, sitting in `agent-interface-transport` is the expected pre-migration state, not a
  // violation: the map states a TARGET. So this edge arms itself one leaf at a time — the moment
  // issue #2108 creates `agent-interface-command`, every command module left behind fails the gate.
  const ownerExists = (o) => existsSync(path.join(ROOT, 'packages', o, 'src'));
  let placementChecked = 0;
  let placementPending = 0;
  for (const owner of owners) {
    const dir = path.join(ROOT, 'packages', owner, 'src');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f === 'index.ts') continue;
      const mod = f.replace(/\.ts$/, '');
      if (!moduleOwner.has(mod)) continue;
      const declared = moduleOwner.get(mod);
      if (declared === owner) {
        placementChecked += 1;
        continue;
      }
      if (!ownerExists(declared)) {
        placementPending += 1;
        continue;
      }
      placementChecked += 1;
      fail.push(
        `PLACEMENT: \`${mod}\` lives in \`${owner}\` but the map assigns it to \`${declared}\`, which exists.`,
      );
    }
  }

  const waves = migrationWaves(edges, owners);
  console.log(
    `::examined:: ${modules.length} contract modules, ${owners.size} declared owners, ${placementChecked} modules placement-checked, ${placementPending} awaiting an owner package that does not exist yet`,
  );
  for (const n of note) console.log(`- [note] ${n}`);
  if (PENDING_CORRECTIONS.length) {
    console.log(
      `- [note] ${PENDING_CORRECTIONS.length} pending correction(s) applied to the projection:`,
    );
    for (const c of PENDING_CORRECTIONS) {
      console.log(
        `         ${c.from} → ${c.to} via \`${c.symbol}\` redirects to \`${c.redirect}\` (${c.leaf}: ${c.why})`,
      );
    }
  }
  console.log(
    `- [note] migration order (extract first what depends on nothing else): ${waves.map((w, i) => `wave ${i + 1} = ${w.join(', ')}`).join('; ')}`,
  );

  if (fail.length) {
    console.error('\ninterface-family-owner scan FAILED:');
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    'interface-family-owner scan passed — owner map is total and the projected package graph is acyclic.',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  main();
}
