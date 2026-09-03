#!/usr/bin/env node

/**
 * Bidirectional check that a package SPEC's Public API table and the package's actual
 * runtime public surface stay in sync. One guard owns both edges of "table ⟷ surface":
 *
 * FORWARD (`spec-phantom-export`) — Guard G3-lite (architecture audit 2026-06-19,
 * AF-13/AF-21 class). Every identifier the table advertises must appear somewhere in
 * `src/`; SPECs had listed phantom exports (e.g. `IPlaygroundBootState`,
 * `createModelCommandModule`) that no longer existed in source.
 *
 * Conservative by design — near-zero false positives:
 * - Only scans sections whose heading matches `Public API` (the standardized surface
 *   table). Type-ownership / dependency / build-output tables are ignored.
 * - Only checks the first back-tick token of each table row, and only when it is a
 *   bare JS identifier (`/^[A-Za-z_$][\w$]*$/`) — sub-paths (`./anthropic`), file
 *   paths, and prose are skipped.
 * - A real export's name always appears in `src/` (at its definition or barrel
 *   re-export); a phantom one appears nowhere. That asymmetry is the whole check.
 *
 * REVERSE (`spec-undocumented-export` / `spec-undocumented-type-export`) —
 * INFRA-DOC-GUARD-001 (architecture audit 2026-06-14, AF-02/AF-04 class). Every EFFECTIVE
 * export of the package entry (`src/index.ts`, plus `browser.ts`/`node.ts` when
 * package.json points there) must be listed as a Public API table identifier. Two
 * surfaces are counted SEPARATELY (issue #2331):
 *
 *   - RUNTIME: direct `export const/function/class/enum`, plus names surfaced by re-export
 *     edges (`export { A, B as C } from './x'` and `export * from './x'` resolved
 *     recursively).
 *   - TYPE: `export interface` / `export type`, `export type { … }`, inline
 *     `export { type A }`, and the type names an `export *` barrel surfaces.
 *
 * Both are the published surface of a TypeScript SDK: removing a published type breaks a
 * consumer at compile time exactly as removing a function breaks it at run time. They are
 * two counts rather than one so a decrement says WHICH surface moved — issue #2331 measured
 * a two-symbol removal (`createSession` + `ICreateSessionResult`) re-freezing `150 → 149`
 * and being read as pinning both, when the type-only half was not counted at all.
 * Parsed via the TypeScript AST (not line-regex) so multi-line `export {` and nested
 * `export *` barrels resolve correctly. Derives from a published completeness contract
 * (spec-writing-standard: "the Public API table MUST list every runtime export of the
 * package entry").
 *
 * Pre-existing documentation debt is frozen as a PER-PACKAGE COUNT RATCHET
 * (`spec-surface-baseline.json`, HARNESS-DIET-003; precedent: the file-size ratchet).
 * The former per-symbol `@robota-sdk#symbol` allowlist had grown to ~641 entries —
 * effectively switching the reverse edge OFF for the whole surface. The ratchet
 * replaces it with one number per package and surface:
 *
 *   - baseline[pkg] = `{ runtime: n, type: m }`, the undocumented entry exports of each
 *     surface frozen at adoption (a surface at 0 is omitted).
 *   - A package's undocumented count may not GROW past its baseline on EITHER surface —
 *     a NEW undocumented export FAILS (document it in the Public API table or un-export it).
 *   - A package or surface absent from the baseline has an allowance of 0.
 *   - Shrinking is always allowed; when a surface drops below its baseline the scan
 *     prints a ratchet-tightening notice naming the surface — regenerate with
 *     `--write-baseline` in the same PR so the ratchet only ever tightens.
 *
 * Known tradeoff (accepted, documented): a count ratchet cannot see a SWAP (document
 * one old undocumented export while adding one new undocumented export in the same
 * package keeps the count flat). The per-symbol precision it gives up is exactly the
 * 641-line list that had neutralized the gate; the count keeps the edge ON at 25
 * entries and burns down mechanically.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from './lib/ts-ast.mjs';
import { listSpecPackageDirs } from './workspace-packages.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { blankComments } from './scan-hook-enforcement-reachable.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/spec-surface-baseline.json');

/** The two published surfaces the reverse edge ratchets, in report order. */
export const SURFACES = Object.freeze(['runtime', 'type']);

/**
 * Frozen per-package undocumented-export counts: package name → `{ runtime, type }`. A bare
 * number (the pre-#2331 shape) is a RUNTIME count only; its type surface reads as 0, so an
 * un-refrozen baseline fails closed on the surface it never counted rather than waiving it.
 */
export function loadUndocumentedExportBaseline(baselinePath = BASELINE_PATH) {
  if (!existsSync(baselinePath)) return {};
  const raw = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const baseline = {};
  for (const [pkgName, entry] of Object.entries(raw)) {
    baseline[pkgName] =
      typeof entry === 'number'
        ? { runtime: entry, type: 0 }
        : { runtime: entry?.runtime ?? 0, type: entry?.type ?? 0 };
  }
  return baseline;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const HEADING = /^#{2,6}\s+(.*)$/;
const PUBLIC_API_HEADING = /public api/i;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const SEPARATOR_ROW = /^\s*\|[\s|:-]+\|\s*$/;
const FIRST_BACKTICK_TOKEN = /`([^`]+)`/;

// Identifiers that are language/spec vocabulary, not package exports.
const VOCAB = new Set(['Export', 'Symbol', 'Kind', 'Type', 'Name', 'Component', 'Hook']);

/**
 * The package's CODE, comments blanked (issue #2228). A comment is the one part of a source file
 * that is free to be ABOUT a symbol rather than to be it — including a comment that says the symbol
 * is NOT here, which this corpus once accepted as proof that it was.
 */
function collectSrcCode(srcDir) {
  let text = '';
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name);
    if (entry.isDirectory()) text += collectSrcCode(full);
    else if (entry.isFile() && /\.(tsx|ts|mjs|cjs)$/.test(entry.name)) {
      text += blankComments(readFileSync(full, 'utf8'));
      text += '\n';
    }
  }
  return text;
}

/**
 * HARNESS-104: the section test is HIERARCHICAL, not a flag.
 *
 * This held a single `inPublicApi` boolean, so ANY heading that did not itself match
 * `/public api/i` closed the section — including a `###` nested INSIDE `## Public API Surface`.
 * A SPEC that groups its surface by subsection therefore had every table after the first
 * subheading skipped, and the scan reported those exports undocumented. Measured before the fix:
 * 196 identifiers invisible across 7 packages, with agent-command, agent-plugin, agent-transport
 * and dag-framework reading as having an entirely empty table.
 *
 * Markdown defines section extent by heading LEVEL (CommonMark ATX headings), so a deeper heading
 * continues the section and one of the same-or-shallower level ends it. `sectionDepth` is that
 * level; 0 means outside. Keeping the terminating half is what stops the fix from over-counting
 * tables that sit outside the public-surface section.
 *
 * CORE-035: the OUTERMOST match owns the extent. HARNESS-104's version re-assigned `sectionDepth` on
 * every matching heading, so a nested `### … Public API …` inside `## Public API Surface` LOWERED the
 * boundary from 2 to 3 — and the next sibling `###` then closed the whole `##` section, even though
 * it had not ended. `agent-core` hit exactly that: `### Abort Classification Public API (CORE-027)`
 * set the depth to 3, and the `### Schema (CORE-015)` immediately after it terminated the surface,
 * making every table below invisible. This is HARNESS-104's own defect one level down, which is why
 * `||` rather than `=`: a match INSIDE an open section is part of it, not a new one.
 */
export function publicApiIdentifiers(specText) {
  const lines = specText.split('\n');
  const idents = [];
  let sectionDepth = 0;
  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[0].match(/^#+/)[0].length;
      if (PUBLIC_API_HEADING.test(heading[1])) sectionDepth = sectionDepth || level;
      else if (sectionDepth && level <= sectionDepth) sectionDepth = 0;
      continue;
    }
    if (!sectionDepth) continue;
    if (SEPARATOR_ROW.test(line) || !TABLE_ROW.test(line)) continue;
    const cell = line.replace(/^\s*\|/, '').split('|')[0];
    const tokenMatch = cell.match(FIRST_BACKTICK_TOKEN);
    if (!tokenMatch) continue;
    const token = tokenMatch[1].trim();
    if (!IDENTIFIER.test(token) || VOCAB.has(token)) continue;
    idents.push(token);
  }
  return [...new Set(idents)];
}

function hasExportModifier(node) {
  return (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Resolve a relative module specifier to its `.ts`/`.tsx` source file, or null. */
function resolveModuleFile(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.(js|mjs)$/, ''));
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Effective export names of a module, by surface: direct declarations plus names surfaced by
 * re-export edges (`export { … } from`, `export * from` resolved recursively). `seen` guards
 * against `export *` cycles.
 *
 * Both surfaces are what a module DECLARES as exported, which is the positive evidence the forward
 * edge needs (issue #2228): a table row is real when it resolves to a genuine export, not when its
 * name is mentioned somewhere in `src/`. Prose is free to be ABOUT a symbol; an export statement
 * has to BE one. The reverse edge ratchets the two surfaces separately (issue #2331).
 *
 * Exported for `scan-workspace-import-integrity` (issue #2230), which asks the same question of an
 * entry file from the importer's side.
 *
 * @returns {{ runtime: Set<string>, type: Set<string> }}
 */
export function effectiveExports(file, seen = new Set()) {
  const names = { runtime: new Set(), type: new Set() };
  if (!file || seen.has(file) || !existsSync(file)) return names;
  seen.add(file);

  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  for (const stmt of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      hasExportModifier(stmt)
    ) {
      names.type.add(stmt.name.text);
      continue;
    }

    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      hasExportModifier(stmt) &&
      stmt.name
    ) {
      // Default exports are anonymous surface, not table identifiers.
      const isDefault = (stmt.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (!isDefault) names.runtime.add(stmt.name.text);
      continue;
    }

    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.runtime.add(decl.name.text);
      }
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      const modSpec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;

      if (!stmt.exportClause) {
        // `export * from './x'` — enumerate the target's own exports, surface by surface;
        // `export type * from './x'` surfaces every name as a type.
        if (modSpec) {
          const target = effectiveExports(resolveModuleFile(file, modSpec), seen);
          for (const name of target.runtime)
            (stmt.isTypeOnly ? names.type : names.runtime).add(name);
          for (const name of target.type) names.type.add(name);
        }
        continue;
      }

      if (ts.isNamedExports(stmt.exportClause)) {
        // `export { A, B as C }` / `export { A } from './x'` — surfaced (exported) names;
        // `export type { … }` and inline `type`-qualified specifiers are the type surface.
        for (const el of stmt.exportClause.elements) {
          (stmt.isTypeOnly || el.isTypeOnly ? names.type : names.runtime).add(el.name.text);
        }
      } else if (stmt.exportClause.name) {
        // `export * as ns from './x'` — one runtime name.
        names.runtime.add(stmt.exportClause.name.text);
      }
    }
  }
  return names;
}

/**
 * The surface a package really declares: every export — runtime AND type — reachable from every
 * entry `package.json` names (issue #2228). Reading only the root entry would trade the wide-corpus
 * defect for the narrow one: a `./testing` subpath is part of the published surface too.
 *
 * @returns {{ entries: string[], names: Set<string> }} — `entries` is reported so a package whose
 *   entries could not be found is a loud finding rather than a table judged against nothing.
 */
export function declaredSurface(pkgDir) {
  const entries = entrySourceFiles(pkgDir);
  const names = new Set();
  for (const entry of entries) {
    const effective = effectiveExports(entry);
    for (const surface of SURFACES) for (const name of effective[surface]) names.add(name);
  }
  return { entries, names };
}

/** Entry source files a package actually ships (package.json exports/main + src/index.ts). */
function entrySourceFiles(pkgDir) {
  const files = new Set();
  const idx = path.join(pkgDir, 'src', 'index.ts');
  if (existsSync(idx)) files.add(idx);

  const ENTRY_BASENAMES = new Set(['index.ts', 'browser.ts', 'node.ts']);
  try {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const visit = (value) => {
      if (typeof value === 'string') {
        if (value.startsWith('./src/')) {
          const resolved = path.resolve(pkgDir, value.replace(/\.(js|mjs)$/, '.ts'));
          if (existsSync(resolved) && ENTRY_BASENAMES.has(path.basename(resolved))) {
            files.add(resolved);
          }
        }
        return;
      }
      if (value && typeof value === 'object')
        for (const inner of Object.values(value)) visit(inner);
    };
    visit(pkg.exports ?? {});
    visit(pkg.main ?? null);
    visit(pkg.module ?? null);
  } catch {
    // allow-fallback: unreadable package.json is reported by other scans; entry falls back to src/index.ts
  }
  return [...files];
}

function packageName(pkgDir, root) {
  try {
    const name = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).name;
    if (typeof name === 'string') return name;
  } catch {
    // fall through to path key
  }
  return path.relative(root, pkgDir);
}

/**
 * Per-package undocumented entry exports by surface:
 * `{ [pkgName]: { specPath, runtime: string[], type: string[] } }`, each list sorted.
 * Packages with zero undocumented exports on both surfaces are omitted.
 */
export function collectUndocumentedExports(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'spec-public-surface',
    why: 'The documented-vs-exported comparison needs both sides; with no packages/ neither exists.',
  });
  const byPackage = {};
  for (const pkgDir of listSpecPackageDirs(root)) {
    const specPath = path.join(pkgDir, 'docs', 'SPEC.md');
    const srcDir = path.join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;

    const entries = entrySourceFiles(pkgDir);
    if (entries.length === 0) continue;

    const tableIdents = new Set(publicApiIdentifiers(readFileSync(specPath, 'utf8')));
    const exportsBySurface = { runtime: new Set(), type: new Set() };
    for (const entry of entries) {
      const effective = effectiveExports(entry);
      for (const surface of SURFACES) {
        for (const name of effective[surface]) exportsBySurface[surface].add(name);
      }
    }

    const undocumented = {};
    for (const surface of SURFACES) {
      undocumented[surface] = [...exportsBySurface[surface]]
        .filter((name) => !tableIdents.has(name))
        .sort();
    }
    if (SURFACES.some((surface) => undocumented[surface].length > 0)) {
      byPackage[packageName(pkgDir, root)] = {
        specPath: path.relative(root, specPath),
        ...undocumented,
      };
    }
  }
  return byPackage;
}

const FINDING_TYPE = Object.freeze({
  runtime: 'spec-undocumented-export',
  type: 'spec-undocumented-type-export',
});

/**
 * Pure reverse-edge ratchet evaluation (exposed for tests). Each surface ratchets on its own,
 * so a finding or a tightening notice always names the surface that moved.
 * @param {Record<string, {specPath: string, runtime: string[], type: string[]}>} undocumentedByPackage
 * @param {Record<string, {runtime: number, type: number}>} baseline package name → frozen counts
 * @returns {{findings: Array<{file, type, detail}>, tightenable: string[]}} `tightenable` entries
 *   are `<package> (<surface>)`
 */
export function evaluateUndocumentedExports(undocumentedByPackage, baseline) {
  const findings = [];
  const tightenable = [];
  const allowanceOf = (pkgName, surface) => baseline[pkgName]?.[surface] ?? 0;

  for (const [pkgName, entry] of Object.entries(undocumentedByPackage)) {
    for (const surface of SURFACES) {
      const names = entry[surface] ?? [];
      const allowed = allowanceOf(pkgName, surface);
      if (names.length > allowed) {
        findings.push({
          file: entry.specPath,
          type: FINDING_TYPE[surface],
          detail:
            `${pkgName} has ${names.length} undocumented ${surface} entry export(s), exceeding its ` +
            `frozen ${surface} baseline of ${allowed} — document the new export(s) in the Public API ` +
            `table, un-export them, or (only for a deliberate policy change) regenerate the baseline. ` +
            `Undocumented: ${names.map((n) => `\`${n}\``).join(', ')}`,
        });
      } else if (names.length < allowed) {
        tightenable.push(`${pkgName} (${surface})`);
      }
    }
  }

  // Baseline surfaces for packages with zero remaining undocumented exports (or gone entirely).
  for (const pkgName of Object.keys(baseline)) {
    if (pkgName in undocumentedByPackage) continue;
    for (const surface of SURFACES) {
      if (allowanceOf(pkgName, surface) > 0) tightenable.push(`${pkgName} (${surface})`);
    }
  }

  return { findings, tightenable: tightenable.sort() };
}

export async function findPublicSurfaceFindings(root = WORKSPACE_ROOT, options = {}) {
  requireGovernedTree(root, ['packages'], {
    scan: 'spec-public-surface',
    why: 'Same corpus as the collector above: an absent packages/ makes "every advertised identifier exists in src/" true of nothing.',
  });
  const baseline = options.baseline ?? loadUndocumentedExportBaseline();
  const notices = options.notices ?? [];
  const findings = [];

  // FORWARD edge: every advertised identifier must be real (issue #2228).
  //
  // Two tiers, in order of evidence strength. A row that resolves to a genuine export — runtime or
  // type — reachable from any entry `package.json` declares is proved positively and needs nothing
  // else. A row that does not (measured 2026-09-04: 77 rows across 5 packages list session METHODS,
  // slash commands and config fields in the same table, which no export resolver can see) must at
  // least appear in the package's CODE. Comments are blanked from that corpus: the defect this
  // closes was a comment saying "`x` is NOT here" counting as proof that it was.
  //
  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  for (const pkgDir of listSpecPackageDirs(root)) {
    const specPath = path.join(pkgDir, 'docs', 'SPEC.md');
    const srcDir = path.join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;

    const specText = readFileSync(specPath, 'utf8');
    const idents = publicApiIdentifiers(specText);
    if (idents.length === 0) continue;

    const { names: declared } = declaredSurface(pkgDir);
    let srcCode = null;
    for (const ident of idents) {
      if (declared.has(ident)) continue;
      srcCode ??= collectSrcCode(srcDir);
      const mentionedInCode = new RegExp(`\\b${ident}\\b`).test(srcCode);
      if (!mentionedInCode) {
        findings.push({
          file: path.relative(root, specPath),
          type: 'spec-phantom-export',
          detail: `\`${ident}\` is advertised in the public-API table but is neither a declared export of any package.json entry nor mentioned in the code (comments excluded) under ${path.relative(root, srcDir)}.`,
        });
      }
    }
  }

  // REVERSE edge: per-package undocumented-export count ratchet.
  const undocumentedByPackage = collectUndocumentedExports(root);
  const { findings: reverseFindings, tightenable } = evaluateUndocumentedExports(
    undocumentedByPackage,
    baseline,
  );
  findings.push(...reverseFindings);
  for (const entry of tightenable) {
    notices.push(
      `${entry} is below its frozen undocumented-export baseline — tighten the ratchet ` +
        `(regenerate spec-surface-baseline.json with --write-baseline in this PR).`,
    );
  }

  return findings;
}

function writeBaseline() {
  const undocumentedByPackage = collectUndocumentedExports(WORKSPACE_ROOT);
  const baseline = {};
  for (const pkgName of Object.keys(undocumentedByPackage).sort()) {
    const counts = {};
    for (const surface of SURFACES) {
      const count = undocumentedByPackage[pkgName][surface].length;
      if (count > 0) counts[surface] = count;
    }
    baseline[pkgName] = counts;
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `spec-surface-baseline.json regenerated (${Object.keys(baseline).length} package(s)).\n`,
  );
}

export async function main() {
  if (process.argv.includes('--write-baseline')) {
    writeBaseline();
    return;
  }
  const notices = [];
  const findings = await findPublicSurfaceFindings(WORKSPACE_ROOT, { notices });
  for (const notice of notices) {
    process.stdout.write(`note: ${notice}\n`);
  }
  if (findings.length === 0) {
    process.stdout.write('spec public-surface scan passed.\n');
    return;
  }
  process.stdout.write('spec public-surface scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
