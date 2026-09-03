#!/usr/bin/env node

/**
 * Interface-package PURITY guard (INFRA-035).
 *
 * `agent-interface-*` packages are dependency-light CONTRACT packages. They may also ship pure,
 * dependency-free derivation accessors over the union types they own (e.g. interaction-contracts'
 * `read*` helpers). The reconciled rule (`.agents/project-structure.md`) allows "contracts + pure
 * derivations" but nothing MECHANICALLY stopped a future edit from adding a runtime dependency edge
 * (a value import of `@robota-sdk/*`, a node builtin, or a third-party like `zod`) or a runtime
 * construct (`class`/`enum`) to an interface package and silently regressing its inertness.
 *
 * This guard enforces the invariant that actually matters — ZERO RUNTIME DEPENDENCY EDGES and NO
 * runtime constructs — for each non-test `.ts` file under `packages/agent-interface-*` src. It FAILS if:
 *
 *   (a) any `import` / `export … from` / `import x = require()` with a BARE (non-relative) module
 *       specifier introduces a VALUE binding — i.e. the statement is not `import type` / `export type`
 *       and not every named specifier is inline `type`-qualified. This covers NAMED, DEFAULT
 *       (`import Foo from 'x'`), NAMESPACE (`import * as z from 'x'`), `export *`, side-effect
 *       (`import 'x'`), and `import x = require('x')` bindings. Relative (`./`, `../`) value
 *       imports/re-exports are OK (they stay inside the package).
 *   (b) a `class` / `abstract class` / `enum` / `const enum` DECLARATION node appears.
 *
 * It uses the TypeScript compiler API (real AST) — NOT line/word grep — so it does not false-positive
 * on the current tree: the multi-line `import type { … } from '@robota-sdk/agent-core'` in
 * `session-contracts.ts` (where `type` is lines above the `from`) is correctly type-only, and the word
 * `class` inside a comment in `background-task-contracts.ts` is not a declaration.
 *
 * Exit code 0 = clean, 1 = violations.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import * as ts from './lib/ts-ast.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, 'packages');

/** A module specifier is "bare" (external) when it is not a relative path. */
function isBareSpecifier(spec) {
  return !spec.startsWith('./') && !spec.startsWith('../');
}

/** True when every named specifier in a NamedImports/NamedExports clause is inline `type`-qualified. */
function allSpecifiersTypeOnly(namedBindings) {
  if (!namedBindings || !namedBindings.elements || namedBindings.elements.length === 0) {
    return false; // no named elements => not an all-type-qualified named clause
  }
  return namedBindings.elements.every((el) => el.isTypeOnly === true);
}

/**
 * Analyze one import-declaration node. Returns a violation kind string if it introduces a bare
 * value binding, else null.
 */
function importDeclarationViolation(node) {
  const spec = node.moduleSpecifier;
  if (!ts.isStringLiteral(spec)) return null;
  if (!isBareSpecifier(spec.text)) return null; // relative value import is allowed

  const clause = node.importClause;
  // Side-effect import: `import 'x'` — no binding, but a real runtime edge.
  if (!clause) return `side-effect import of '${spec.text}'`;
  // `import type ...` — fully type-only, allowed. Read through the adapter: the import PHASE is
  // spelled differently by the two ASTs, and the adapter owns that difference.
  if (ts.isTypeOnlyImportClause(clause)) return null;

  // `import Foo from 'x'` — default value binding.
  if (clause.name) return `default value import from '${spec.text}'`;

  const bindings = clause.namedBindings;
  if (!bindings) return null;
  // `import * as z from 'x'` — namespace value binding.
  if (ts.isNamespaceImport(bindings)) return `namespace value import from '${spec.text}'`;
  // `import { a, type b } from 'x'` — value unless every specifier is `type`-qualified.
  if (ts.isNamedImports(bindings)) {
    if (allSpecifiersTypeOnly(bindings)) return null;
    return `value import from '${spec.text}'`;
  }
  return null;
}

/**
 * Analyze one `export … from` node. Returns a violation kind string if it re-exports a value from a
 * bare specifier, else null.
 */
function exportDeclarationViolation(node) {
  const spec = node.moduleSpecifier;
  if (!spec || !ts.isStringLiteral(spec)) return null; // local `export { x }` (no `from`) — not an edge
  if (!isBareSpecifier(spec.text)) return null; // relative value re-export is allowed
  if (node.isTypeOnly) return null; // `export type { … } from 'x'`

  const clause = node.exportClause;
  // `export * from 'x'` — namespace value re-export.
  if (!clause) return `value re-export (export *) from '${spec.text}'`;
  // `export { a, type b } from 'x'` — value unless every specifier is `type`-qualified.
  if (ts.isNamedExports(clause)) {
    if (allSpecifiersTypeOnly(clause)) return null;
    return `value re-export from '${spec.text}'`;
  }
  return null;
}

/** `import x = require('x')` (or `import x = SomeModule`). */
function importEqualsViolation(node) {
  if (node.isTypeOnly) return null;
  const ref = node.moduleReference;
  if (ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteral(ref.expression)) {
    if (isBareSpecifier(ref.expression.text)) {
      return `import-require value binding from '${ref.expression.text}'`;
    }
  }
  return null;
}

/**
 * Find every runtime-purity violation in one source string. Exported for the fixture self-test.
 * Returns array of { line, kind, detail }.
 */
export function findRuntimeViolationsInSource(sourceText, fileName = 'fixture.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const violations = [];
  const record = (node, kind, detail) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({ line: line + 1, kind, detail });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const detail = importDeclarationViolation(node);
      if (detail) record(node, 'runtime-import', detail);
    } else if (ts.isExportDeclaration(node)) {
      const detail = exportDeclarationViolation(node);
      if (detail) record(node, 'runtime-import', detail);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const detail = importEqualsViolation(node);
      if (detail) record(node, 'runtime-import', detail);
    } else if (ts.isClassDeclaration(node)) {
      const isAbstract = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword);
      record(node, 'runtime-construct', `${isAbstract ? 'abstract class' : 'class'} declaration`);
    } else if (ts.isEnumDeclaration(node)) {
      const isConst = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ConstKeyword);
      record(node, 'runtime-construct', `${isConst ? 'const enum' : 'enum'} declaration`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/** Enumerate `packages/agent-interface-*` package directories (mirrors check-interface-imports). */
export function findInterfacePackages(packagesDir = PACKAGES_DIR) {
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('agent-interface-'))
    .map((e) => path.join(packagesDir, e.name, 'src'))
    .filter((src) => existsSync(src) && statSync(src).isDirectory());
}

/** Collect non-test `*.ts` files under a src dir. */
function collectSourceFiles(srcDir) {
  const files = [];
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        stack.push(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(full);
      }
    }
  }
  return files;
}

/**
 * HARNESS-103 — the second edge: what the package's ENTRY actually publishes.
 *
 * `.agents/project-structure.md` says an `agent-interface-*` package "must not contain classes or
 * runtime logic". The edge above enforces a narrower thing — no `class`/`enum` declaration, no bare
 * value import — and its own operator message says to "keep pure functions over owned types", so a
 * 100-line prototype-walking forwarder passed while sitting outside the rule.
 *
 * The distinction that makes the rule mechanical: a CONTRACT package may publish the vocabulary of
 * its contracts and the predicates that discriminate them. It may not publish a mechanism.
 *
 *   contract-shaped  — a `const` binding (the vocabulary), or a function whose return type is a
 *                      type predicate `x is T` (the discriminator).
 *   mechanism        — anything else exported as a runtime value from the entry.
 *
 * `testing/` is exempt by the repository's own placement rule — `contracts→agent-interface-*,
 * doubles→owner /testing` — so a double factory living there is where it belongs, not a violation.
 *
 * Existing mechanisms are frozen per package in `interface-entry-baseline.json` and may only
 * shrink. Freezing rather than failing outright is deliberate: the count is the honest size of a
 * debt that was invisible while the guard measured something narrower, and a burn-down that is
 * recorded beats a gate that is switched off.
 */
const ENTRY_BASELINE_PATH = path.join(
  WORKSPACE_ROOT,
  'scripts/harness/interface-entry-baseline.json',
);

export function loadEntryBaseline(baselinePath = ENTRY_BASELINE_PATH) {
  if (!existsSync(baselinePath)) return {};
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
}

function parseSource(fileName, sourceText) {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
}

function hasExportModifier(node) {
  return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
}

/** Resolve a relative specifier (`./x.js`, `./x`, `./dir`) to the `.ts` file it names, or null. */
function resolveRelativeModule(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.(js|ts)$/, ''));
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Top-level VALUE declarations of a module (const/let/function/class/enum), exported or not. */
function localValueDeclarations(sf) {
  const exported = new Set();
  const all = new Set();
  for (const st of sf.statements) {
    let names = [];
    if (ts.isVariableStatement(st)) {
      names = st.declarationList.declarations
        .filter((d) => d.name && ts.isIdentifier(d.name))
        .map((d) => d.name.text);
    } else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) &&
      st.name
    ) {
      names = [st.name.text];
    }
    for (const n of names) {
      all.add(n);
      if (hasExportModifier(st)) exported.add(n);
    }
  }
  return { all, exported };
}

/**
 * Every RUNTIME value a module publishes, with the file and local name to classify it from: its own
 * exported declarations, its relative named re-exports, and — recursively — everything behind a
 * relative `export *`.
 *
 * Issue #2221: a star re-export names nothing, so an enumerator that reads only named clauses
 * produced, for a barrel over a sub-barrel, output identical to a package that publishes no
 * runtime values at all. What cannot be followed (a target that does not exist, a namespace
 * re-export) is returned in `unresolved` rather than dropped — a guard that says nothing about
 * what it could not see is indistinguishable from a guard that found nothing.
 */
function moduleRuntimeExports(file, seen = new Set()) {
  const exports = [];
  const unresolved = [];
  if (seen.has(file)) return { exports, unresolved };
  seen.add(file);
  const sf = parseSource(file, readFileSync(file, 'utf8'));
  const local = localValueDeclarations(sf);
  for (const name of local.exported) exports.push({ name, file, localName: name });
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.isTypeOnly) continue;
    const spec =
      st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
    if (spec !== null && isBareSpecifier(spec)) continue; // the source edge owns bare re-exports
    const target = spec === null ? file : resolveRelativeModule(file, spec);
    const clause = st.exportClause;
    if (!clause) {
      if (!target) {
        unresolved.push({ name: '*', source: spec, reason: 'target not found' });
        continue;
      }
      const inner = moduleRuntimeExports(target, seen);
      exports.push(...inner.exports);
      unresolved.push(...inner.unresolved);
      continue;
    }
    if (!ts.isNamedExports(clause)) {
      unresolved.push({
        name: clause.name?.text ?? '*',
        source: spec,
        reason: 'namespace re-export',
      });
      continue;
    }
    for (const el of clause.elements) {
      if (el.isTypeOnly) continue;
      const localName = (el.propertyName ?? el.name).text;
      if (spec === null) {
        if (local.all.has(localName)) exports.push({ name: el.name.text, file, localName });
        continue; // a local `export { T }` of a type is not a runtime value
      }
      if (!target) {
        unresolved.push({ name: el.name.text, source: spec, reason: 'target not found' });
        continue;
      }
      exports.push({ name: el.name.text, file: target, localName });
    }
  }
  return { exports, unresolved };
}

/**
 * Classify a function-like by what it RETURNS: a type-predicate annotation is the contract's
 * discriminator, anything else is behaviour.
 *
 * The shim exposes no isTypePredicateNode; a type predicate is the only return annotation whose
 * text contains ` is `, which is exactly the discriminator shape.
 */
function classifyFunctionLike(node) {
  const ret = node.type ? node.type.getText() : '';
  return / is /.test(ret) ? 'discriminator' : 'mechanism';
}

/**
 * Classify the value `name` as published by `file`, following `export { a as name } from` and
 * `export *` chains to the DECLARING file rather than stopping one hop in (issue #2221). Returns
 * 'vocabulary' | 'discriminator' | 'mechanism' | 'unresolved'.
 */
function classifyExport(file, name, seen = new Set()) {
  const key = `${file}::${name}`;
  if (seen.has(key)) return 'unresolved';
  seen.add(key);
  const sf = parseSource(file, readFileSync(file, 'utf8'));
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!d.name || d.name.text !== name) continue;
        // A `const` holding a function is a function. Judging by the DECLARATION KEYWORD rather
        // than by what the binding holds would repeat the very defect HARNESS-103 is about — a
        // check narrower than the rule it enforces — because `export const doThing = () => { … }`
        // is a mechanism whichever keyword introduces it.
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          return classifyFunctionLike(init);
        }
        return 'vocabulary';
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name && st.name.text === name) {
      return classifyFunctionLike(st);
    }
    if ((ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name?.text === name) {
      return 'mechanism';
    }
  }
  // Not declared here: follow the relative re-exports that could carry it.
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.isTypeOnly) continue;
    if (!st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (isBareSpecifier(st.moduleSpecifier.text)) continue;
    const target = resolveRelativeModule(file, st.moduleSpecifier.text);
    if (!target) continue;
    const clause = st.exportClause;
    if (!clause) {
      const kind = classifyExport(target, name, seen);
      if (kind !== 'unresolved') return kind;
      continue;
    }
    if (!ts.isNamedExports(clause)) continue;
    for (const el of clause.elements) {
      if (el.isTypeOnly || el.name.text !== name) continue;
      const kind = classifyExport(target, (el.propertyName ?? el.name).text, seen);
      if (kind !== 'unresolved') return kind;
    }
  }
  return 'unresolved';
}

export function findEntryRuntimeMechanisms(packagesDir = PACKAGES_DIR) {
  const byPackage = {};
  const unresolvedByPackage = {};
  let entriesScanned = 0;
  let exportsExamined = 0;
  for (const srcDir of findInterfacePackages(packagesDir)) {
    const pkg = path.basename(path.dirname(srcDir));
    const entry = path.join(srcDir, 'index.ts');
    if (!existsSync(entry)) continue;
    entriesScanned += 1;
    const { exports, unresolved } = moduleRuntimeExports(entry);
    const mechanisms = new Set();
    const unresolvedNames = unresolved.map((u) => `${u.name} from '${u.source}' (${u.reason})`);
    const seenNames = new Set();
    for (const { name, file, localName } of exports) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      exportsExamined += 1;
      const kind = classifyExport(file, localName);
      // `testing/` is the sanctioned home for doubles; the entry must not route around that.
      if (kind === 'mechanism') mechanisms.add(name);
      else if (kind === 'unresolved') unresolvedNames.push(`${name} (declaration not found)`);
    }
    byPackage[pkg] = [...mechanisms].sort();
    unresolvedByPackage[pkg] = unresolvedNames.sort();
  }
  return { byPackage, unresolvedByPackage, entriesScanned, exportsExamined };
}

/** Exported so a test can read the size this scan reports (measurement-provenance.md). */
export function readExaminedEntryCount(packagesDir = PACKAGES_DIR) {
  return findEntryRuntimeMechanisms(packagesDir).entriesScanned;
}

export function findEntryBaselineFindings(
  packagesDir = PACKAGES_DIR,
  baseline = loadEntryBaseline(),
) {
  const { byPackage, unresolvedByPackage, entriesScanned, exportsExamined } =
    findEntryRuntimeMechanisms(packagesDir);
  const findings = [];
  // Issue #2221: what the entry publishes but the scan could not classify is a FINDING, not a
  // silence — otherwise an unfollowable re-export reads exactly like an inert package.
  for (const [pkg, names] of Object.entries(unresolvedByPackage)) {
    if (names.length === 0) continue;
    findings.push({
      pkg,
      kind: 'unresolved-export',
      problem:
        `entry publishes ${names.length} export(s) this scan could not resolve to a declaration ` +
        `(${names.join(', ')}). Fix the re-export so the declaring file is reachable; an ` +
        `unclassifiable export is not a clean one.`,
    });
  }
  for (const [pkg, names] of Object.entries(byPackage)) {
    const allowed = baseline[pkg] ?? 0;
    if (names.length > allowed) {
      findings.push({
        pkg,
        kind: 'entry-mechanism',
        problem:
          `entry publishes ${names.length} runtime mechanism(s) (${names.join(', ')}) but the ` +
          `frozen allowance is ${allowed}. An agent-interface-* package publishes contracts, its ` +
          `vocabulary and its discriminators — not mechanisms. Move it to an owner package, or to ` +
          `testing/ if it is a double.`,
      });
    }
  }
  return { findings, byPackage, unresolvedByPackage, entriesScanned, exportsExamined };
}

export function scanInterfaceRuntime() {
  const findings = [];
  let filesScanned = 0;
  for (const srcDir of findInterfacePackages()) {
    for (const file of collectSourceFiles(srcDir)) {
      filesScanned += 1;
      const source = readFileSync(file, 'utf8');
      for (const v of findRuntimeViolationsInSource(source, file)) {
        findings.push({ file: path.relative(WORKSPACE_ROOT, file), ...v });
      }
    }
  }
  return { findings, filesScanned };
}

function main() {
  const { findings, filesScanned } = scanInterfaceRuntime();
  // HARNESS-103: the entry edge runs alongside the source edge. Reported separately because they
  // answer different questions — "does this package CONTAIN a runtime construct" and "does this
  // package PUBLISH a mechanism" — and the second is the one the rule's words actually cover.
  const entry = findEntryBaselineFindings();
  if (entry.findings.length > 0) {
    console.error(
      '❌ Interface-package entry publishes a runtime mechanism or an unresolved export:\n',
    );
    for (const f of entry.findings) console.error(`  [${f.kind}] ${f.pkg} — ${f.problem}`);
    console.error('');
    console.error(
      `interface-runtime summary: entry-violations=${entry.findings.length} entries=${entry.entriesScanned} ` +
        `entry-exports=${entry.exportsExamined} result=FAIL`,
    );
    process.exit(1);
  }
  if (findings.length > 0) {
    console.error('❌ Interface-package purity violations found:\n');
    console.error(
      '  agent-interface-* packages must stay runtime-inert: no bare (external) VALUE import/re-export\n' +
        '  and no class/enum declaration. Use `import type` / type-qualified specifiers; keep pure\n' +
        '  functions over owned types (relative imports are fine).\n',
    );
    for (const f of findings) {
      console.error(`  [${f.kind}] ${f.file}:${f.line} — ${f.detail}`);
    }
    console.error('');
    console.error(
      `interface-runtime summary: violations=${findings.length} scanned=${filesScanned} result=FAIL`,
    );
    process.exit(1);
  }
  console.log('✅ No interface-package purity violations found.');
  console.log(`::examined:: ${filesScanned} source files`);
  console.log(`::examined:: ${entry.entriesScanned} package entries`);
  console.log(`::examined:: ${entry.exportsExamined} entry exports (0 unresolved)`);
  console.log(`interface-runtime summary: violations=0 scanned=${filesScanned} result=PASS`);
  process.exit(0);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  main();
}
