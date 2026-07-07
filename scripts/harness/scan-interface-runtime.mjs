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
import ts from 'typescript';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
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
  // `import type ...` — fully type-only, allowed.
  if (clause.isTypeOnly) return null;

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
  console.log(`interface-runtime summary: violations=0 scanned=${filesScanned} result=PASS`);
  process.exit(0);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  main();
}
