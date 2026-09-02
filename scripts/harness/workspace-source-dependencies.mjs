import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';

import { normalizeWorkspacePath } from './workspace-affected-git.mjs';

const WORKSPACE_CODE_GLOB = '**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}';
const SOURCE_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
];

export function extractLiteralModuleSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*['"]([^'"]+)['"]/gu,
    /\b(?:import|require(?:\.resolve)?)\s*\(\s*['"]([^'"]+)['"]/gu,
  ]) {
    for (const match of String(source ?? '').matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers].sort();
}

function isProductionSourcePath(relativeFile) {
  if (/(?:^|\/)(?:__tests__|tests|__fixtures__)(?:\/|$)/u.test(relativeFile)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relativeFile)) return false;
  return /^(?:src|app|pages|components|server|lib)\//u.test(relativeFile);
}

function importedWorkspaceNames(source, workspaceNames) {
  const found = new Set();
  for (const specifier of extractLiteralModuleSpecifiers(source)) {
    for (const name of workspaceNames) {
      if (specifier === name || specifier.startsWith(`${name}/`)) {
        found.add(name);
        break;
      }
    }
  }
  return found;
}

export function readWorkspaceImportDependencies(
  root,
  workspacePackage,
  workspaceNames,
  { listSourceFiles = globSync, readSourceFile = readFileSync } = {},
) {
  if (workspacePackage.directory === 'scratch') return { production: [], verification: [] };
  const workspaceRoot = path.join(root, workspacePackage.directory);
  let files;
  try {
    files = listSourceFiles(WORKSPACE_CODE_GLOB, {
      cwd: workspaceRoot,
      onlyFiles: true,
      dot: true,
      ignore: SOURCE_IGNORES,
    })
      .map(normalizeWorkspacePath)
      .sort();
  } catch (error) {
    throw new Error(
      `cannot enumerate workspace source ${workspacePackage.directory}: ${error.message}`,
    );
  }
  const production = new Set();
  const verification = new Set();
  for (const file of files) {
    let source;
    try {
      source = readSourceFile(path.join(workspaceRoot, file), 'utf8');
    } catch (error) {
      throw new Error(
        `cannot read workspace source ${workspacePackage.directory}/${file}: ${error.message}`,
      );
    }
    const imported = importedWorkspaceNames(source, workspaceNames);
    for (const name of imported) verification.add(name);
    if (isProductionSourcePath(file)) for (const name of imported) production.add(name);
  }
  return { production: [...production].sort(), verification: [...verification].sort() };
}

export function isIntegrationTestEvidencePath(relativeFile) {
  return (
    /(?:^|\/)(?:__tests__|tests|__fixtures__|fixtures)(?:\/|$)/u.test(relativeFile) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relativeFile) ||
    /(?:^|\/)(?:vitest|jest|test)\.config\.[cm]?[jt]s$/u.test(relativeFile)
  );
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function hasLiteralWorkspaceReference({
  root,
  workspacePackage,
  packageName,
  readCandidateFile = readFileSync,
  listCandidateFiles = globSync,
}) {
  const candidateRoot = path.join(root, workspacePackage.directory);
  let files;
  try {
    files = listCandidateFiles(WORKSPACE_CODE_GLOB, {
      cwd: candidateRoot,
      onlyFiles: true,
      dot: true,
      ignore: SOURCE_IGNORES,
    })
      .map(normalizeWorkspacePath)
      .filter(isIntegrationTestEvidencePath)
      .sort();
  } catch (error) {
    throw new Error(
      `cannot enumerate integration candidate ${workspacePackage.directory}: ${error.message}`,
    );
  }
  const specifier = `${escapeForRegExp(packageName)}(?:/[^'"\\s]+)?`;
  const reference = new RegExp(
    `(?:\\b(?:import|export)[\\s\\S]{0,200}?\\bfrom\\s*['"]${specifier}['"]|` +
      `\\bimport\\s*['"]${specifier}['"]|` +
      `\\bimport\\s*\\(\\s*['"]${specifier}['"]|` +
      `\\brequire(?:\\.resolve)?\\s*\\(\\s*['"]${specifier}['"])`,
    'u',
  );
  for (const file of files) {
    try {
      if (reference.test(readCandidateFile(path.join(candidateRoot, file), 'utf8'))) return true;
    } catch (error) {
      throw new Error(
        `cannot read integration candidate ${workspacePackage.directory}/${file}: ${error.message}`,
      );
    }
  }
  return false;
}
