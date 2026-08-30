import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  ScriptKind,
  ScriptTarget,
  createSourceFile,
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
} from './lib/ts-ast.mjs';

const DECLARATION_PREFIX = /^\s*\/\/\s*harness-coverage:/u;
const EXACT_DECLARATION = /^\/\/ harness-coverage: (\S+)$/u;
const TOP_LEVEL_MODULE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mjs$/u;

function declarationsIn(source, test) {
  const declarations = [];
  for (const line of source.split(/\r?\n/u)) {
    if (!DECLARATION_PREFIX.test(line)) continue;
    const match = EXACT_DECLARATION.exec(line);
    if (!match) throw new Error(`malformed harness coverage declaration in ${test}: ${line}`);
    declarations.push(match[1]);
  }
  return declarations;
}

function resolveLocalModule(importer, specifier, moduleDir) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(importer), specifier);
  const relative = path.relative(moduleDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  return resolved;
}

function staticLocalImports(file, moduleDir) {
  const source = readFileSync(file, 'utf8');
  const tree = createSourceFile(file, source, ScriptTarget.Latest, true, ScriptKind.JS);
  const imports = [];
  for (const statement of tree.statements) {
    if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !isStringLiteral(statement.moduleSpecifier)) continue;
    const resolved = resolveLocalModule(file, statement.moduleSpecifier.text, moduleDir);
    if (resolved !== null) imports.push(resolved);
  }
  return imports;
}

function reachableStaticModules(testFile, moduleDir) {
  const reachable = new Set();
  const pending = [testFile];
  while (pending.length > 0) {
    const current = pending.pop();
    if (reachable.has(current)) continue;
    reachable.add(current);
    pending.push(...staticLocalImports(current, moduleDir));
  }
  reachable.delete(testFile);
  return reachable;
}

function validateTarget(moduleDir, target, test) {
  if (!TOP_LEVEL_MODULE.test(target) || path.basename(target) !== target) {
    throw new Error(
      `harness coverage target must be a top-level .mjs module: ${target} in ${test}`,
    );
  }
  const file = path.join(moduleDir, target);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`harness coverage target does not exist: ${target} in ${test}`);
  }
  return file;
}

export function declaredHarnessCoverage(testDir, tests) {
  const moduleDir = path.dirname(testDir);
  const owners = new Map();
  for (const test of tests.filter((name) => name.endsWith('.test.mjs')).sort()) {
    const testFile = path.join(testDir, test);
    const declarations = declarationsIn(readFileSync(testFile, 'utf8'), test);
    const reachable =
      declarations.length === 0 ? null : reachableStaticModules(testFile, moduleDir);
    for (const target of declarations) {
      const targetFile = validateTarget(moduleDir, target, test);
      if (owners.has(target)) {
        throw new Error(
          `duplicate harness coverage declaration for ${target}: ${owners.get(target)}, ${test}`,
        );
      }
      if (!reachable.has(targetFile)) {
        throw new Error(`${test} declares ${target} without a static import path to that module`);
      }
      owners.set(target, test);
    }
  }
  return new Set(owners.keys());
}
