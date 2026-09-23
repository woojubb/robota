import { readFileSync } from 'node:fs';
import path from 'node:path';

import { extractSourceReferences } from './workspace-source-reference-extraction.mjs';
import { resolveSourceReference } from './workspace-source-reference-resolution.mjs';
import { normalizeWorkspacePath } from './workspace-affected-git.mjs';
import { collectFiles } from './enumerate-files.mjs';
import {
  collectWorkspaceSourceInventory,
  WORKSPACE_SOURCE_EXCLUSIONS,
} from './workspace-source-inventory.mjs';

export { extractSourceReferences } from './workspace-source-reference-extraction.mjs';

const WORKSPACE_CODE_GLOB = '**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}';
const SOURCE_IGNORES = [
  ...WORKSPACE_SOURCE_EXCLUSIONS.directoryNames.map((name) => `**/${name}/**`),
  ...WORKSPACE_SOURCE_EXCLUSIONS.packageRootDirectoryNames.map((name) => `${name}/**`),
];

/** One explicit inventory selection. Default checkout enumeration never falls back from Git. */
export function collectWorkspaceReferenceInventory(
  root,
  packages,
  collect = collectFiles,
  { mode = 'git' } = {},
) {
  return collectWorkspaceSourceInventory(root, { packages, collect, mode });
}

function isAuthoredCode(file) {
  const segments = file.split('/');
  return (
    /\.[cm]?[jt]sx?$/u.test(file) &&
    file !== '..' &&
    !file.startsWith('../') &&
    !path.posix.isAbsolute(file) &&
    !segments.some((segment) => WORKSPACE_SOURCE_EXCLUSIONS.directoryNames.includes(segment)) &&
    !WORKSPACE_SOURCE_EXCLUSIONS.packageRootDirectoryNames.some((name) =>
      file.startsWith(`${name}/`),
    )
  );
}

function sourceFilesFor(root, workspacePackage, { listSourceFiles, sourceFiles } = {}) {
  const directory = workspacePackage.directory;
  const candidates = listSourceFiles
    ? listSourceFiles(WORKSPACE_CODE_GLOB, {
        cwd: path.join(root, directory),
        onlyFiles: true,
        dot: true,
        follow: false,
        ignore: SOURCE_IGNORES,
      })
    : [...(sourceFiles ?? collectWorkspaceReferenceInventory(root, [workspacePackage]).files)]
        .filter((file) => file.startsWith(`${directory}/`))
        .map((file) => file.slice(directory.length + 1));
  return [...new Set(candidates.map(normalizeWorkspacePath))].filter(isAuthoredCode).sort();
}

export function extractLiteralModuleSpecifiers(source, fileName = 'workspace-reference.ts') {
  return [
    ...new Set(
      extractSourceReferences(source, fileName)
        .filter((reference) => reference.kind === 'module' && reference.specifier !== undefined)
        .map((reference) => reference.specifier),
    ),
  ].sort();
}

function isProductionSourcePath(relativeFile) {
  if (/(?:^|\/)(?:__tests__|tests|__fixtures__)(?:\/|$)/u.test(relativeFile)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relativeFile)) return false;
  return /^(?:src|app|pages|components|server|lib)\//u.test(relativeFile);
}

function importedWorkspaceNames(references, workspaceNames, packages = []) {
  const found = new Set();
  const owners = [...packages].sort((a, b) => b.directory.length - a.directory.length);
  for (const reference of references) {
    if (reference.kind !== 'module') continue;
    if (reference.resolution?.status === 'resolved') {
      for (const target of reference.resolution.targets) {
        const owner = owners.find((entry) => target.startsWith(`${entry.directory}/`));
        if (owner && workspaceNames.has(owner.name)) found.add(owner.name);
      }
      continue;
    }
    // Preserve the existing named-package prerequisite even when its entry cannot be resolved.
    // The unresolved evidence remains visible; this is not a fabricated source target.
    if (reference.specifier === undefined) continue;
    const specifier = reference.specifier;
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
  { listSourceFiles, sourceFiles, readSourceFile = readFileSync, resolutionContext } = {},
) {
  if (workspacePackage.directory === 'scratch')
    return { production: [], verification: [], references: [] };
  const workspaceRoot = path.join(root, workspacePackage.directory);
  let files;
  try {
    files = sourceFilesFor(root, workspacePackage, {
      listSourceFiles,
      sourceFiles: sourceFiles ?? resolutionContext?.files,
    });
  } catch (error) {
    throw new Error(
      `cannot enumerate workspace source ${workspacePackage.directory}: ${error.message}`,
    );
  }
  const production = new Set();
  const verification = new Set();
  const references = [];
  for (const file of files) {
    let source;
    try {
      source = readSourceFile(path.join(workspaceRoot, file), 'utf8');
    } catch (error) {
      throw new Error(
        `cannot read workspace source ${workspacePackage.directory}/${file}: ${error.message}`,
      );
    }
    const context = isProductionSourcePath(file)
      ? 'production'
      : isIntegrationTestEvidencePath(file)
        ? 'verification'
        : 'tooling';
    const fileReferences = extractSourceReferences(source, `${workspacePackage.directory}/${file}`)
      .map((reference) => ({ ...reference, context }))
      .map((reference) =>
        resolutionContext ? resolveSourceReference(reference, resolutionContext) : reference,
      );
    references.push(...fileReferences);
    const imported = importedWorkspaceNames(
      fileReferences,
      workspaceNames,
      resolutionContext?.packages,
    );
    for (const name of imported) verification.add(name);
    if (isProductionSourcePath(file)) for (const name of imported) production.add(name);
  }
  return { production: [...production].sort(), verification: [...verification].sort(), references };
}

export function isIntegrationTestEvidencePath(relativeFile) {
  return (
    /(?:^|\/)(?:__tests__|tests|__fixtures__|fixtures)(?:\/|$)/u.test(relativeFile) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relativeFile) ||
    /(?:^|\/)(?:vitest|jest|test)\.config\.[cm]?[jt]s$/u.test(relativeFile)
  );
}

export function hasLiteralWorkspaceReference({
  root,
  workspacePackage,
  packageName,
  readCandidateFile = readFileSync,
  listCandidateFiles,
  sourceFiles,
  resolutionContext,
}) {
  const candidateRoot = path.join(root, workspacePackage.directory);
  let files;
  try {
    files = sourceFilesFor(root, workspacePackage, {
      listSourceFiles: listCandidateFiles,
      sourceFiles: sourceFiles ?? resolutionContext?.files,
    })
      .filter(isIntegrationTestEvidencePath)
      .sort();
  } catch (error) {
    throw new Error(
      `cannot enumerate integration candidate ${workspacePackage.directory}: ${error.message}`,
    );
  }
  for (const file of files) {
    try {
      const references = extractSourceReferences(
        readCandidateFile(path.join(candidateRoot, file), 'utf8'),
        `${workspacePackage.directory}/${file}`,
      ).map((reference) =>
        resolutionContext ? resolveSourceReference(reference, resolutionContext) : reference,
      );
      if (
        importedWorkspaceNames(references, new Set([packageName]), resolutionContext?.packages).has(
          packageName,
        )
      ) {
        return true;
      }
    } catch (error) {
      throw new Error(
        `cannot read integration candidate ${workspacePackage.directory}/${file}: ${error.message}`,
      );
    }
  }
  return false;
}
