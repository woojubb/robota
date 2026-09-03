#!/usr/bin/env node

/**
 * Issue #2230 — a file may import a workspace package its manifest does not declare, and name a
 * symbol that package does not export, and every gate stays silent.
 *
 * Measured on `26621ba07`: a test file imported `IInteractiveSessionRecord` from
 * `@robota-sdk/agent-interface-transport` — a package `agent-session` did not declare, exporting a
 * symbol that had moved to `agent-interface-session`. pnpm's hoisting resolved the specifier, the
 * type-only import was erased at runtime, `typecheck` does not see test files (#2192), and the
 * manifest-level and module-level guards were each right about their own question. The gap is
 * BETWEEN them, so this reads what a source file actually imports and compares it against two
 * things: the importer's declared dependencies, and the named package's real exports.
 *
 * Corpus: EVERY source file of every workspace package and app — tests included, because that is
 * where the instance lived and where the default exclusion had hidden it. The scan states how many
 * files and packages it examined, so a corpus that quietly shrinks is visible (HARNESS-057).
 *
 * Only WORKSPACE packages are judged. A relative import, a `node:` builtin and a third-party package
 * are outside the question (the first two are not dependencies; the third is `check-dep-kind`'s).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { effectiveExports } from './check-spec-public-surface.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';
import { listSourceFiles, listWorkspacePackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

let examinedFiles = 0;
let examinedPackages = 0;

export function examinedFileCount() {
  return examinedFiles;
}

export function examinedPackageCount() {
  return examinedPackages;
}

function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

/** `{ name → { dir, manifest, declared: Set } }` for every workspace package and app. */
export function workspacePackages(root = WORKSPACE_ROOT) {
  const byName = new Map();
  for (const dir of listWorkspacePackageDirs(root)) {
    if (!existsSync(path.join(dir, 'package.json'))) continue;
    const manifest = readManifest(dir);
    if (typeof manifest.name !== 'string') continue;
    const declared = new Set();
    for (const field of DEPENDENCY_FIELDS) {
      for (const name of Object.keys(manifest[field] ?? {})) declared.add(name);
    }
    byName.set(manifest.name, { dir, manifest, declared });
  }
  return byName;
}

/** The workspace package a specifier names, and its subpath (`.` for the root), or null. */
export function workspaceTarget(specifier, names) {
  for (const name of names) {
    if (specifier === name) return { name, subpath: '.' };
    if (specifier.startsWith(`${name}/`))
      return { name, subpath: `.${specifier.slice(name.length)}` };
  }
  return null;
}

/** Source entry file for a package subpath, via `exports` (src or dist→src) or `src/index.ts`. */
export function entryFileFor(pkg, subpath) {
  const candidates = [];
  const visit = (value) => {
    if (typeof value === 'string') candidates.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  const exportsMap = pkg.manifest.exports;
  if (exportsMap && typeof exportsMap === 'object' && !Array.isArray(exportsMap)) {
    visit(exportsMap[subpath]);
  } else if (subpath === '.') {
    visit(pkg.manifest.main ?? null);
  }
  if (subpath === '.' && candidates.length === 0) candidates.push('./src/index.ts');
  for (const candidate of candidates) {
    const asSource = candidate
      .replace(/^\.\/dist\//, './src/')
      .replace(/\.d\.ts$/, '.ts')
      .replace(/\.(js|mjs|cjs)$/, '.ts');
    for (const file of [
      asSource,
      asSource.replace(/\.ts$/, '.tsx'),
      asSource.replace(/\.ts$/, '/index.ts'),
    ]) {
      const abs = path.resolve(pkg.dir, file);
      if (existsSync(abs)) return abs;
    }
  }
  return null;
}

/**
 * Named imports a file makes from non-relative specifiers, by specifier:
 * `import { A, type B, C as D } from 'x'` → x: [A, B, C]; `export { E } from 'x'` → x: [E].
 * Default and namespace imports name no symbol, so they are checked for declaration only.
 */
export function namedImportsOf(file, sourceText) {
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bySpecifier = new Map();
  const add = (specifier, name) => {
    if (!bySpecifier.has(specifier)) bySpecifier.set(specifier, []);
    if (name !== null) bySpecifier.get(specifier).push(name);
  };
  for (const stmt of sourceFile.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      add(specifier, null);
      const bindings = stmt.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) add(specifier, (el.propertyName ?? el.name).text);
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const specifier = stmt.moduleSpecifier.text;
      add(specifier, null);
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements)
          add(specifier, (el.propertyName ?? el.name).text);
      }
    }
  }
  return bySpecifier;
}

function exportNamesOf(pkg, subpath, cache) {
  const key = `${pkg.manifest.name}\0${subpath}`;
  if (cache.has(key)) return cache.get(key);
  const entry = entryFileFor(pkg, subpath);
  let names = null;
  if (entry !== null) {
    const effective = effectiveExports(entry);
    names = new Set([...effective.runtime, ...effective.type]);
  }
  cache.set(key, names);
  return names;
}

/** Other workspace packages whose ROOT entry exports `symbol` — the hint when one has moved. */
function packagesExporting(symbol, packages, cache) {
  const owners = [];
  for (const [name, pkg] of packages) {
    if (exportNamesOf(pkg, '.', cache)?.has(symbol)) owners.push(name);
  }
  return owners;
}

/** @returns {Array<{file: string, type: string, detail: string}>} */
export function findWorkspaceImportIntegrityFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'workspace-import-integrity',
    why: 'The importers and the packages they name both live there.',
  });
  const packages = workspacePackages(root);
  const names = [...packages.keys()].sort((a, b) => b.length - a.length);
  const cache = new Map();
  const findings = [];
  examinedFiles = 0;
  examinedPackages = 0;

  for (const [importerName, importer] of packages) {
    examinedPackages += 1;
    for (const file of listSourceFiles(importer.dir, { excludeTests: false })) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const sourceText = readFileSync(file, 'utf8');
      examinedFiles += 1;

      // Declared? Judged from the AST's static import/export declarations, not a regex over the
      // text: a code generator's TEMPLATE STRING `import { x } from '@robota-sdk/agent-framework'`
      // is prose about an import, not one (measured: two false positives in agent-playground).
      // Dynamic `import()` / `require()` are outside this scan, and stated so rather than guessed.
      const imports = namedImportsOf(file, sourceText);
      const undeclared = new Set();
      for (const specifier of imports.keys()) {
        const target = workspaceTarget(specifier, names);
        if (target === null || target.name === importerName) continue;
        if (!importer.declared.has(target.name)) undeclared.add(target.name);
      }
      for (const name of [...undeclared].sort()) {
        findings.push({
          file: rel,
          type: 'workspace-import-undeclared',
          detail: `imports \`${name}\`, which ${importerName}'s package.json does not declare in any dependency field — it resolves only by hoisting.`,
        });
      }

      // Exported? Only the named bindings can be asked; each is asked of the real entry.
      for (const [specifier, symbols] of imports) {
        const target = workspaceTarget(specifier, names);
        if (target === null || symbols.length === 0) continue;
        const exported = exportNamesOf(packages.get(target.name), target.subpath, cache);
        if (exported === null) continue; // no source entry to ask — not a claim either way
        for (const symbol of symbols) {
          if (exported.has(symbol)) continue;
          const owners = packagesExporting(symbol, packages, cache).filter(
            (n) => n !== target.name,
          );
          findings.push({
            file: rel,
            type: 'workspace-import-missing-export',
            detail:
              `imports \`${symbol}\` from \`${specifier}\`, which does not export it` +
              (owners.length > 0 ? ` (exported by ${owners.join(', ')})` : '') +
              '.',
          });
        }
      }
    }
  }
  return findings;
}

export async function main() {
  const findings = findWorkspaceImportIntegrityFindings();
  process.stdout.write(
    `::examined:: ${examinedFiles} source file(s) across ${examinedPackages} workspace package(s)\n`,
  );
  if (findings.length === 0) {
    process.stdout.write('workspace-import-integrity scan passed.\n');
    return;
  }
  process.stdout.write('workspace-import-integrity scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
