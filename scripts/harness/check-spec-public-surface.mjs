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
 * REVERSE (`spec-undocumented-export`) — INFRA-DOC-GUARD-001 (architecture audit
 * 2026-06-14, AF-02/AF-04 class). Every EFFECTIVE runtime export of the package entry
 * (`src/index.ts`, plus `browser.ts`/`node.ts` when package.json points there) must be
 * listed as a Public API table identifier. "Effective runtime export" = direct
 * `export const/function/class/enum`, plus names surfaced by re-export edges
 * (`export { A, B as C } from './x'` and `export * from './x'` resolved recursively) —
 * excluding all type-only exports (`export type`, `interface`, `export { type A }`).
 * Parsed via the TypeScript AST (not line-regex) so multi-line `export {` and nested
 * `export *` barrels resolve correctly. Derives from a published completeness contract
 * (spec-writing-standard: "the Public API table MUST list every runtime export of the
 * package entry").
 *
 * Pre-existing documentation debt is frozen as a PER-PACKAGE COUNT RATCHET
 * (`spec-surface-baseline.json`, HARNESS-DIET-003; precedent: the file-size ratchet).
 * The former per-symbol `@robota-sdk#symbol` allowlist had grown to ~641 entries —
 * effectively switching the reverse edge OFF for the whole surface. The ratchet
 * replaces it with one number per package:
 *
 *   - baseline[pkg] = number of undocumented runtime entry exports frozen at adoption.
 *   - A package's undocumented count may not GROW past its baseline — a NEW
 *     undocumented export FAILS (document it in the Public API table or un-export it).
 *   - A package absent from the baseline has an allowance of 0.
 *   - Shrinking is always allowed; when a package drops below its baseline the scan
 *     prints a ratchet-tightening notice — regenerate with `--write-baseline` in the
 *     same PR so the ratchet only ever tightens.
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
import ts from 'typescript';

import { listSpecPackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/spec-surface-baseline.json');

/** Frozen per-package undocumented-export counts (package name → count). */
export function loadUndocumentedExportBaseline(baselinePath = BASELINE_PATH) {
  if (!existsSync(baselinePath)) return {};
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const HEADING = /^#{2,6}\s+(.*)$/;
const PUBLIC_API_HEADING = /public api/i;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const SEPARATOR_ROW = /^\s*\|[\s|:-]+\|\s*$/;
const FIRST_BACKTICK_TOKEN = /`([^`]+)`/;

// Identifiers that are language/spec vocabulary, not package exports.
const VOCAB = new Set(['Export', 'Symbol', 'Kind', 'Type', 'Name', 'Component', 'Hook']);

function collectSrcText(srcDir) {
  let text = '';
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name);
    if (entry.isDirectory()) text += collectSrcText(full);
    else if (entry.isFile() && /\.(tsx|ts|mjs|cjs)$/.test(entry.name)) {
      text += readFileSync(full, 'utf8');
      text += '\n';
    }
  }
  return text;
}

function publicApiIdentifiers(specText) {
  const lines = specText.split('\n');
  const idents = [];
  let inPublicApi = false;
  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      inPublicApi = PUBLIC_API_HEADING.test(heading[1]);
      continue;
    }
    if (!inPublicApi) continue;
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
 * Effective runtime export names of a module: direct runtime declarations plus names
 * surfaced by re-export edges (`export { … } from`, `export * from` resolved recursively).
 * Type-only exports are excluded. `seen` guards against `export *` cycles.
 */
function effectiveRuntimeExports(file, seen = new Set()) {
  const names = new Set();
  if (!file || seen.has(file) || !existsSync(file)) return names;
  seen.add(file);

  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  for (const stmt of sourceFile.statements) {
    // Type-only declarations never contribute a runtime export.
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;

    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      hasExportModifier(stmt) &&
      stmt.name
    ) {
      // Default exports are anonymous surface, not table identifiers.
      const isDefault = (stmt.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (!isDefault) names.add(stmt.name.text);
      continue;
    }

    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue; // `export type { … }`
      const modSpec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;

      if (!stmt.exportClause) {
        // `export * from './x'` — enumerate the target's own runtime exports.
        if (modSpec) {
          for (const name of effectiveRuntimeExports(resolveModuleFile(file, modSpec), seen)) {
            names.add(name);
          }
        }
        continue;
      }

      if (ts.isNamedExports(stmt.exportClause)) {
        // `export { A, B as C }` / `export { A } from './x'` — surfaced (exported) names,
        // excluding inline `type`-qualified specifiers.
        for (const el of stmt.exportClause.elements) {
          if (el.isTypeOnly) continue;
          names.add(el.name.text);
        }
      }
    }
  }
  return names;
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
 * Per-package undocumented runtime entry exports: `{ [pkgName]: { specPath, names } }`,
 * where `names` is sorted. Packages with zero undocumented exports are omitted.
 */
export function collectUndocumentedExports(root = WORKSPACE_ROOT) {
  const byPackage = {};
  for (const pkgDir of listSpecPackageDirs(root)) {
    const specPath = path.join(pkgDir, 'docs', 'SPEC.md');
    const srcDir = path.join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;

    const entries = entrySourceFiles(pkgDir);
    if (entries.length === 0) continue;

    const tableIdents = new Set(publicApiIdentifiers(readFileSync(specPath, 'utf8')));
    const runtimeExports = new Set();
    for (const entry of entries) {
      for (const name of effectiveRuntimeExports(entry)) runtimeExports.add(name);
    }

    const undocumented = [...runtimeExports].filter((name) => !tableIdents.has(name)).sort();
    if (undocumented.length > 0) {
      byPackage[packageName(pkgDir, root)] = {
        specPath: path.relative(root, specPath),
        names: undocumented,
      };
    }
  }
  return byPackage;
}

/**
 * Pure reverse-edge ratchet evaluation (exposed for tests).
 * @param {Record<string, {specPath: string, names: string[]}>} undocumentedByPackage
 * @param {Record<string, number>} baseline package name → frozen undocumented count
 * @returns {{findings: Array<{file, type, detail}>, tightenable: string[]}}
 */
export function evaluateUndocumentedExports(undocumentedByPackage, baseline) {
  const findings = [];
  const tightenable = [];

  for (const [pkgName, { specPath, names }] of Object.entries(undocumentedByPackage)) {
    const allowed = baseline[pkgName] ?? 0;
    if (names.length > allowed) {
      findings.push({
        file: specPath,
        type: 'spec-undocumented-export',
        detail:
          `${pkgName} has ${names.length} undocumented runtime entry export(s), exceeding its ` +
          `frozen baseline of ${allowed} — document the new export(s) in the Public API table, ` +
          `un-export them, or (only for a deliberate policy change) regenerate the baseline. ` +
          `Undocumented: ${names.map((n) => `\`${n}\``).join(', ')}`,
      });
    } else if (names.length < allowed) {
      tightenable.push(pkgName);
    }
  }

  // Baseline entries for packages with zero remaining undocumented exports (or gone entirely).
  for (const pkgName of Object.keys(baseline)) {
    if (!(pkgName in undocumentedByPackage)) tightenable.push(pkgName);
  }

  return { findings, tightenable: tightenable.sort() };
}

export async function findPublicSurfaceFindings(root = WORKSPACE_ROOT, options = {}) {
  const baseline = options.baseline ?? loadUndocumentedExportBaseline();
  const notices = options.notices ?? [];
  const findings = [];

  // FORWARD edge: every advertised identifier must appear in src/.
  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  for (const pkgDir of listSpecPackageDirs(root)) {
    const specPath = path.join(pkgDir, 'docs', 'SPEC.md');
    const srcDir = path.join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;

    const specText = readFileSync(specPath, 'utf8');
    const idents = publicApiIdentifiers(specText);
    if (idents.length === 0) continue;

    const srcText = collectSrcText(srcDir);
    for (const ident of idents) {
      const present = new RegExp(`\\b${ident}\\b`).test(srcText);
      if (!present) {
        findings.push({
          file: path.relative(root, specPath),
          type: 'spec-phantom-export',
          detail: `\`${ident}\` is advertised in the public-API table but appears nowhere in ${path.relative(root, srcDir)}.`,
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
  for (const pkgName of tightenable) {
    notices.push(
      `${pkgName} is below its frozen undocumented-export baseline — tighten the ratchet ` +
        `(regenerate spec-surface-baseline.json with --write-baseline in this PR).`,
    );
  }

  return findings;
}

function writeBaseline() {
  const undocumentedByPackage = collectUndocumentedExports(WORKSPACE_ROOT);
  const baseline = {};
  for (const pkgName of Object.keys(undocumentedByPackage).sort()) {
    baseline[pkgName] = undocumentedByPackage[pkgName].names.length;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
