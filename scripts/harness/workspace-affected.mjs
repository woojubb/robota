#!/usr/bin/env node

/**
 * Pure package-wise execution planner for pnpm workspaces.
 *
 * This module deliberately plans commands without executing them. Callers can consume the stable
 * JSON plan and decide how to shard or invoke pnpm while retaining one fail-closed owner for changed
 * paths. Normal lint/typecheck stay owner-local, tests expand only to proven integration suites,
 * builds add production prerequisites, and reverse-consumer builds remain explicit/manual.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';

import { resolveWorkspaceCapability } from './workspace-operation-registry.mjs';

const BUILD_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const DEVELOPMENT_DEPENDENCY_FIELDS = ['devDependencies'];
const WORKSPACE_CODE_GLOB = '**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}';

export const WORKSPACE_OPERATIONS = Object.freeze([
  'build',
  'consumer-build',
  'test',
  'typecheck',
  'lint',
  'examples-typecheck',
]);

const GLOBAL_FILES = new Set([
  '.eslintignore',
  '.eslintrc.json',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.eslint.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vitest.shared.ts',
]);

const GLOBAL_PREFIXES = [
  '.github/workflows/',
  'scripts/build-',
  'scripts/harness/workspace-affected.',
];

const NO_PACKAGE_FILES = new Set([
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
]);

const NO_PACKAGE_PREFIXES = ['.agents/', '.changeset/', 'docs/'];

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/+$/u, '');

function runGitDefault(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

/** Parse `git diff --name-status -z`, preserving both old and new sides of renames/copies. */
export function parseNameStatusDiff(output) {
  const tokens = String(output ?? '').split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const files = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[ACDMRTUXB][0-9]*$/u.test(status ?? '')) {
      throw new Error(`unreadable git diff status: ${status || '<empty>'}`);
    }
    const pathCount = /^[RC]/u.test(status) ? 2 : 1;
    for (let offset = 0; offset < pathCount; offset += 1) {
      const file = normalize(tokens[index++]);
      if (!file) throw new Error(`unreadable git diff path after ${status}`);
      files.push(file);
    }
  }
  return [...new Set(files)].sort();
}

function parseNulPaths(output) {
  return String(output ?? '')
    .split('\0')
    .map(normalize)
    .filter(Boolean);
}

/**
 * Resolve committed changes against every merge base. Local verification additionally includes the
 * index, worktree, and untracked files; CI intentionally ignores those mutable local surfaces.
 */
export function resolveChangedFiles({
  root,
  baseRef,
  headRef = 'HEAD',
  runGit = runGitDefault,
  environment = process.env,
}) {
  if (!baseRef || !headRef) return { ok: false, reason: 'base/head ref is missing', files: [] };
  const merge = runGit(['merge-base', '--all', baseRef, headRef], { cwd: root });
  if (merge?.status !== 0 || merge?.signal) {
    return { ok: false, reason: 'merge-base lookup failed', files: [] };
  }
  const mergeBases = String(merge.stdout ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  if (mergeBases.length === 0) {
    return { ok: false, reason: 'merge-base lookup was empty', files: [] };
  }

  const files = new Set();
  try {
    for (const mergeBase of mergeBases) {
      const diff = runGit(['diff', '--name-status', '-z', '-M', '-C', mergeBase, headRef], {
        cwd: root,
      });
      if (diff?.status !== 0 || diff?.signal) {
        return { ok: false, reason: `diff against ${mergeBase} failed`, files: [] };
      }
      for (const file of parseNameStatusDiff(diff.stdout)) files.add(file);
    }
    const includeLocalChanges = !environment.CI && !environment.GITHUB_ACTIONS;
    if (includeLocalChanges) {
      for (const [label, args] of [
        ['staged', ['diff', '--name-status', '-z', '-M', '-C', '--cached']],
        ['unstaged', ['diff', '--name-status', '-z', '-M', '-C']],
      ]) {
        const diff = runGit(args, { cwd: root });
        if (diff?.status !== 0 || diff?.signal) {
          return { ok: false, reason: `${label} diff failed`, files: [] };
        }
        for (const file of parseNameStatusDiff(diff.stdout)) files.add(file);
      }
      const untracked = runGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root });
      if (untracked?.status !== 0 || untracked?.signal) {
        return { ok: false, reason: 'untracked-file lookup failed', files: [] };
      }
      for (const file of parseNulPaths(untracked.stdout)) files.add(file);
    }
  } catch (error) {
    return { ok: false, reason: error.message, files: [] };
  }

  if (files.size === 0) return { ok: false, reason: 'changed-file diff was empty', files: [] };
  return { ok: true, mergeBases, files: [...files].sort() };
}

/** Parse only the top-level `packages:` sequence from pnpm-workspace.yaml. */
export function parseWorkspacePatterns(source) {
  const patterns = [];
  let packagesIndent = null;
  for (const rawLine of String(source ?? '').split(/\r?\n/u)) {
    const withoutComment = rawLine.replace(/\s+#.*$/u, '');
    if (packagesIndent === null) {
      const match = /^(\s*)packages:\s*$/u.exec(withoutComment);
      if (match) packagesIndent = match[1].length;
      continue;
    }
    if (!withoutComment.trim()) continue;
    const indent = /^\s*/u.exec(withoutComment)?.[0].length ?? 0;
    if (indent <= packagesIndent) break;
    const item = /^\s*-\s+(.+?)\s*$/u.exec(withoutComment)?.[1];
    if (!item) throw new Error('pnpm workspace packages list is unreadable');
    const value = item.replace(/^(['"])(.*)\1$/u, '$2').trim();
    if (!value) throw new Error('pnpm workspace contains an empty package pattern');
    patterns.push(value);
  }
  if (packagesIndent === null || patterns.length === 0) {
    throw new Error('pnpm workspace packages list is missing or empty');
  }
  return patterns;
}

function manifestDependencyNames(manifest, fields) {
  const names = new Set();
  for (const field of fields) {
    const values = manifest[field];
    if (values === undefined) continue;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error(`manifest ${field} must be an object`);
    }
    for (const name of Object.keys(values)) names.add(name);
  }
  return [...names].sort();
}

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
      ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.next/**', '**/.turbo/**'],
    })
      .map(normalize)
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
  return {
    production: [...production].sort(),
    verification: [...verification].sort(),
  };
}

/** Discover all workspace manifests from pnpm's declared globs, never from package-name constants. */
export function readWorkspaceGraph(root) {
  const workspaceFile = path.join(root, 'pnpm-workspace.yaml');
  const patterns = parseWorkspacePatterns(readFileSync(workspaceFile, 'utf8'));
  const excluded = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));
  const included = patterns.filter((pattern) => !pattern.startsWith('!'));
  const directories = globSync(included, {
    cwd: root,
    onlyDirectories: true,
    dot: false,
    ignore: ['**/node_modules/**', ...excluded],
  })
    .map(normalize)
    .filter((directory) => directory && existsSync(path.join(root, directory, 'package.json')))
    .sort();

  const byName = new Map();
  const packages = [];
  for (const directory of [...new Set(directories)]) {
    const manifestPath = path.join(root, directory, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(`cannot read workspace manifest ${directory}/package.json: ${error.message}`);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error(`workspace manifest ${directory}/package.json is not an object`);
    }
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
      throw new Error(`workspace manifest ${directory}/package.json has no name`);
    }
    const name = manifest.name.trim();
    if (byName.has(name)) throw new Error(`duplicate workspace package name: ${name}`);
    const entry = {
      name,
      directory,
      scripts:
        manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
          ? manifest.scripts
          : {},
      productionDependencyNames: manifestDependencyNames(manifest, BUILD_DEPENDENCY_FIELDS),
      developmentDependencyNames: manifestDependencyNames(manifest, DEVELOPMENT_DEPENDENCY_FIELDS),
    };
    packages.push(entry);
    byName.set(name, entry);
  }
  if (packages.length === 0) throw new Error('workspace patterns resolved to zero packages');

  const workspaceNames = new Set(packages.map((entry) => entry.name));
  for (const entry of packages) {
    const imports = readWorkspaceImportDependencies(root, entry, workspaceNames);
    entry.buildDependencies = [
      ...new Set([
        ...entry.productionDependencyNames.filter((name) => workspaceNames.has(name)),
        ...imports.production.filter((name) => name !== entry.name),
      ]),
    ].sort();
    entry.typecheckDependencies = [
      ...new Set(imports.production.filter((name) => name !== entry.name)),
    ].sort();
    entry.testDependencies = [
      ...new Set([...imports.verification.filter((name) => name !== entry.name)]),
    ].sort();
    entry.verificationDependencies = [...entry.testDependencies];
    // Compatibility alias for existing build-stage consumers. New consumers should use the pure
    // operation helper below so verification edges never leak into production builds.
    entry.dependencies = [...entry.buildDependencies];
    delete entry.productionDependencyNames;
    delete entry.developmentDependencyNames;
  }
  const sortedPackages = packages.sort((a, b) => a.directory.localeCompare(b.directory));
  assertAcyclicWorkspaceGraph(sortedPackages);
  return { patterns, packages: sortedPackages };
}

export function workspaceDependenciesForOperation(workspacePackage, operation) {
  if (operation === 'build' || operation === 'consumer-build') {
    return [...(workspacePackage.buildDependencies ?? workspacePackage.dependencies ?? [])].sort();
  }
  if (operation === 'typecheck' || operation === 'examples-typecheck') {
    return [
      ...(workspacePackage.typecheckDependencies ??
        workspacePackage.verificationDependencies ??
        workspacePackage.buildDependencies ??
        workspacePackage.dependencies ??
        []),
    ].sort();
  }
  return [
    ...(workspacePackage.testDependencies ??
      workspacePackage.verificationDependencies ??
      workspacePackage.buildDependencies ??
      workspacePackage.dependencies ??
      []),
  ].sort();
}

export function createWorkspaceReachability(packages, operation) {
  const dependencies = new Map(
    packages.map((workspacePackage) => [
      workspacePackage.name,
      workspaceDependenciesForOperation(workspacePackage, operation),
    ]),
  );
  const dependents = new Map(packages.map((workspacePackage) => [workspacePackage.name, []]));
  for (const [name, dependencyNames] of dependencies) {
    for (const dependency of dependencyNames) {
      if (!dependents.has(dependency))
        throw new Error(`unknown workspace dependency: ${dependency}`);
      dependents.get(dependency).push(name);
    }
  }
  for (const names of dependents.values()) names.sort();
  return { dependencies, dependents };
}

function assertAcyclicWorkspaceGraph(packages) {
  const dependencies = new Map(packages.map((entry) => [entry.name, entry.dependencies ?? []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(name, trail) {
    if (visiting.has(name)) {
      const cycleStart = trail.indexOf(name);
      throw new Error(
        `workspace dependency cycle: ${[...trail.slice(cycleStart), name].join(' -> ')}`,
      );
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies.get(name) ?? []) visit(dependency, [...trail, name]);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of [...dependencies.keys()].sort()) visit(name, []);
}

function isOwned(file, workspacePackage) {
  return file === workspacePackage.directory || file.startsWith(`${workspacePackage.directory}/`);
}

function isGlobalPath(file) {
  return GLOBAL_FILES.has(file) || GLOBAL_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isNoPackagePath(file) {
  return (
    NO_PACKAGE_FILES.has(file) || NO_PACKAGE_PREFIXES.some((prefix) => file.startsWith(prefix))
  );
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
  listCandidateFiles = globSync,
}) {
  const candidateRoot = path.join(root, workspacePackage.directory);
  let files;
  try {
    files = listCandidateFiles('**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}', {
      cwd: candidateRoot,
      onlyFiles: true,
      dot: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.next/**', '**/.turbo/**'],
    })
      .map(normalize)
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

function transitiveClosure(startNames, adjacency) {
  const found = new Set();
  const queue = [...startNames].sort();
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (startNames.has(next) || found.has(next)) continue;
      found.add(next);
      queue.push(next);
      queue.sort();
    }
  }
  return found;
}

function packageRows(names, byName, reasons) {
  return [...names]
    .map((name) => ({
      name,
      directory: byName.get(name).directory,
      reasons: [...(reasons.get(name) ?? [])].sort(),
    }))
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

function globalPlan({ operation, changedFiles, reason, mergeBases = [] }) {
  return {
    version: 1,
    operation,
    mode: 'global',
    packageDistributable: false,
    globalFallback: true,
    reason,
    changedFiles: [...changedFiles].sort(),
    mergeBases: [...mergeBases].sort(),
    owners: [],
    dependencyClosure: [],
    dependentClosure: [],
    packages: [],
  };
}

function addReason(reasons, name, reason) {
  if (!reasons.has(name)) reasons.set(name, new Set());
  reasons.get(name).add(reason);
}

/**
 * Create a deterministic, package-distributable plan or an explicit global/no-package result.
 */
export function createWorkspaceAffectedPlan({
  root,
  operation,
  changedFiles,
  mergeBases = [],
  graph,
  integrationOwners = {},
  typecheckIntegrationOwners = {},
  candidateReferenceResolver = hasLiteralWorkspaceReference,
  full = false,
}) {
  if (!WORKSPACE_OPERATIONS.includes(operation)) {
    return globalPlan({
      operation,
      changedFiles: changedFiles ?? [],
      reason: `unknown operation: ${operation}`,
    });
  }
  const files = [...new Set((changedFiles ?? []).map(normalize).filter(Boolean))].sort();
  if (full) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: 'full mode requested',
    });
  }
  if (files.length === 0) {
    return globalPlan({
      operation,
      changedFiles: [],
      mergeBases,
      reason: 'changed-file set is empty',
    });
  }
  if (files.some(isGlobalPath)) {
    const triggers = files.filter(isGlobalPath);
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `workspace-wide input changed: ${triggers.join(', ')}`,
    });
  }

  let resolvedGraph;
  try {
    resolvedGraph = graph ?? readWorkspaceGraph(root);
    if (
      !resolvedGraph ||
      !Array.isArray(resolvedGraph.packages) ||
      resolvedGraph.packages.length === 0
    ) {
      throw new Error('workspace graph is empty');
    }
  } catch (error) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `workspace graph is unreadable: ${error.message}`,
    });
  }

  const packages = [...resolvedGraph.packages].sort((a, b) =>
    a.directory.localeCompare(b.directory),
  );
  const byName = new Map();
  try {
    for (const workspacePackage of packages) {
      if (
        !workspacePackage?.name ||
        !workspacePackage?.directory ||
        byName.has(workspacePackage.name)
      ) {
        throw new Error('workspace graph contains an invalid or duplicate package');
      }
      byName.set(workspacePackage.name, workspacePackage);
    }
    for (const workspacePackage of packages) {
      for (const dependency of workspacePackage.dependencies ?? []) {
        if (!byName.has(dependency)) throw new Error(`unknown workspace dependency: ${dependency}`);
      }
    }
  } catch (error) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `workspace graph is unreadable: ${error.message}`,
    });
  }

  const ownerNames = new Set();
  const reasons = new Map();
  const unknown = [];
  for (const file of files) {
    const owners = packages.filter((workspacePackage) => isOwned(file, workspacePackage));
    if (owners.length > 1) {
      return globalPlan({
        operation,
        changedFiles: files,
        mergeBases,
        reason: `ambiguous package owner for ${file}`,
      });
    }
    if (owners.length === 1) {
      const name = owners[0].name;
      ownerNames.add(name);
      if (!reasons.has(name)) reasons.set(name, new Set());
      reasons.get(name).add(`owner:${file}`);
    } else if (!isNoPackagePath(file)) {
      unknown.push(file);
    }
  }
  if (unknown.length > 0) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `unknown changed path: ${unknown.join(', ')}`,
    });
  }
  if (ownerNames.size === 0) {
    return {
      version: 1,
      operation,
      mode: 'none',
      packageDistributable: true,
      globalFallback: false,
      reason: 'recognized documentation/governance changes affect no workspace package',
      changedFiles: files,
      mergeBases: [...mergeBases].sort(),
      owners: [],
      dependencyClosure: [],
      dependentClosure: [],
      packages: [],
    };
  }

  let dependencies;
  let dependents;
  try {
    ({ dependencies, dependents } = createWorkspaceReachability(packages, operation));
  } catch (error) {
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: `workspace graph is unreadable: ${error.message}`,
    });
  }

  let dependencyNames = new Set();
  let dependentNames = new Set();
  let selectedNames = new Set(ownerNames);
  if (operation === 'build') {
    dependencyNames = transitiveClosure(ownerNames, dependencies);
    selectedNames = new Set([...ownerNames, ...dependencyNames]);
  } else if (operation === 'typecheck') {
    const registered = new Set();
    for (const owner of ownerNames) {
      const integrations = typecheckIntegrationOwners[owner] ?? [];
      if (!Array.isArray(integrations)) {
        return globalPlan({
          operation,
          changedFiles: files,
          mergeBases,
          reason: `typecheck integration owner registry is unreadable for ${owner}`,
        });
      }
      for (const integration of integrations) {
        const candidate = byName.get(integration);
        if (!candidate) {
          return globalPlan({
            operation,
            changedFiles: files,
            mergeBases,
            reason: `unknown typecheck integration owner ${integration} registered for ${owner}`,
          });
        }
        if (resolveWorkspaceCapability(candidate, 'typecheck').kind !== 'script') {
          return globalPlan({
            operation,
            changedFiles: files,
            mergeBases,
            reason: `typecheck integration owner ${integration} has no real typecheck capability`,
          });
        }
        registered.add(integration);
        addReason(reasons, integration, `typecheck-integration-owner-for:${owner}`);
      }
    }
    selectedNames = new Set([...ownerNames, ...registered]);
  } else if (operation === 'consumer-build') {
    dependentNames = transitiveClosure(ownerNames, dependents);
    const consumers = new Set([...ownerNames, ...dependentNames]);
    dependencyNames = transitiveClosure(consumers, dependencies);
    selectedNames = new Set([...consumers, ...dependencyNames]);
  } else if (operation === 'test') {
    const registered = new Set();
    for (const owner of ownerNames) {
      const integrations = integrationOwners[owner] ?? [];
      if (!Array.isArray(integrations)) {
        return globalPlan({
          operation,
          changedFiles: files,
          mergeBases,
          reason: `integration owner registry is unreadable for ${owner}`,
        });
      }
      for (const integration of integrations) {
        if (!byName.has(integration)) {
          return globalPlan({
            operation,
            changedFiles: files,
            mergeBases,
            reason: `unknown integration owner ${integration} registered for ${owner}`,
          });
        }
        if (resolveWorkspaceCapability(byName.get(integration), 'test').kind !== 'script') {
          return globalPlan({
            operation,
            changedFiles: files,
            mergeBases,
            reason: `integration owner ${integration} has no real test capability`,
          });
        }
        registered.add(integration);
        addReason(reasons, integration, `integration-owner-for:${owner}`);
      }
      for (const candidateName of dependents.get(owner) ?? []) {
        if (ownerNames.has(candidateName) || registered.has(candidateName)) continue;
        const candidate = byName.get(candidateName);
        if (resolveWorkspaceCapability(candidate, 'test').kind !== 'script') continue;
        let referencesOwner;
        try {
          referencesOwner = candidateReferenceResolver({
            root,
            workspacePackage: candidate,
            packageName: owner,
          });
        } catch (error) {
          return globalPlan({
            operation,
            changedFiles: files,
            mergeBases,
            reason: `integration reference scan failed: ${error.message}`,
          });
        }
        if (referencesOwner) {
          registered.add(candidateName);
          addReason(reasons, candidateName, `literal-import-of:${owner}`);
        }
      }
    }
    selectedNames = new Set([...ownerNames, ...registered]);
  } else if (operation === 'examples-typecheck') {
    selectedNames = new Set(
      [...ownerNames].filter((name) => byName.get(name).directory.startsWith('examples/')),
    );
  }
  if (selectedNames.size === 0) {
    if (operation === 'examples-typecheck') {
      return {
        version: 1,
        operation,
        mode: 'none',
        packageDistributable: true,
        globalFallback: false,
        reason: 'no changed workspace package is an example owner',
        changedFiles: files,
        mergeBases: [...mergeBases].sort(),
        owners: packageRows(ownerNames, byName, reasons),
        dependencyClosure: [],
        dependentClosure: [],
        packages: [],
      };
    }
    return globalPlan({
      operation,
      changedFiles: files,
      mergeBases,
      reason: 'source changes selected zero packages; using full verification',
    });
  }
  for (const name of dependencyNames) {
    addReason(reasons, name, `dependency-of:${[...ownerNames].sort().join(',')}`);
  }
  for (const name of dependentNames) {
    addReason(reasons, name, `dependent-of:${[...ownerNames].sort().join(',')}`);
  }
  return {
    version: 1,
    operation,
    mode: 'packages',
    packageDistributable: true,
    globalFallback: false,
    reason: 'workspace packages selected',
    changedFiles: files,
    mergeBases: [...mergeBases].sort(),
    owners: packageRows(ownerNames, byName, reasons),
    dependencyClosure: packageRows(dependencyNames, byName, reasons),
    dependentClosure: packageRows(dependentNames, byName, reasons),
    packages: packageRows(selectedNames, byName, reasons),
  };
}

/** Resolve the diff and graph, converting every read failure into a global fallback plan. */
export function planWorkspaceAffected({
  root = process.cwd(),
  operation,
  changedFiles,
  baseRef,
  headRef = 'HEAD',
  runGit,
  environment,
  integrationOwners,
  typecheckIntegrationOwners,
  candidateReferenceResolver,
  full = false,
}) {
  if (full) {
    return createWorkspaceAffectedPlan({
      root,
      operation,
      changedFiles: changedFiles ?? [],
      integrationOwners,
      typecheckIntegrationOwners,
      candidateReferenceResolver,
      full: true,
    });
  }
  let resolution;
  if (changedFiles !== undefined) {
    resolution = { ok: true, files: changedFiles, mergeBases: [] };
  } else {
    resolution = resolveChangedFiles({ root, baseRef, headRef, runGit, environment });
  }
  if (!resolution.ok) {
    return globalPlan({
      operation,
      changedFiles: resolution.files ?? [],
      reason: `changed files are unreadable: ${resolution.reason}`,
    });
  }
  return createWorkspaceAffectedPlan({
    root,
    operation,
    changedFiles: resolution.files,
    mergeBases: resolution.mergeBases,
    integrationOwners,
    typecheckIntegrationOwners,
    candidateReferenceResolver,
    full,
  });
}

export function formatWorkspaceAffectedPlan(plan, format = 'text') {
  if (format === 'json') return `${JSON.stringify(plan, null, 2)}\n`;
  if (format !== 'text') throw new Error(`unsupported format: ${format}`);
  const lines = [
    `mode: ${plan.mode}`,
    `operation: ${plan.operation}`,
    `package-distributable: ${plan.packageDistributable ? 'yes' : 'no'}`,
    `reason: ${plan.reason}`,
  ];
  if (plan.owners.length > 0)
    lines.push(`owners: ${plan.owners.map((entry) => entry.directory).join(', ')}`);
  if (plan.packages.length > 0)
    lines.push(`packages: ${plan.packages.map((entry) => entry.directory).join(', ')}`);
  return `${lines.join('\n')}\n`;
}

export function parseCliArgs(argv) {
  const options = { changedFiles: [], format: 'text' };
  let hasExplicitFiles = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${token} requires a value`);
      index += 1;
      return next;
    };
    if (token === '--operation') options.operation = value();
    else if (token === '--base-ref') options.baseRef = value();
    else if (token === '--head-ref') options.headRef = value();
    else if (token === '--root') options.root = path.resolve(value());
    else if (token === '--changed-file') {
      hasExplicitFiles = true;
      options.changedFiles.push(value());
    } else if (token === '--format') options.format = value();
    else if (token === '--full') options.full = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!options.operation) throw new Error('--operation is required');
  if (!hasExplicitFiles) delete options.changedFiles;
  if (options.format !== 'json' && options.format !== 'text') {
    throw new Error('--format must be json or text');
  }
  return options;
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const plan = planWorkspaceAffected(options);
    process.stdout.write(formatWorkspaceAffectedPlan(plan, options.format));
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`workspace-affected: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
