import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';

import { normalizeWorkspacePath } from './workspace-affected-git.mjs';
import { readWorkspaceImportDependencies } from './workspace-source-dependencies.mjs';

const BUILD_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const DEVELOPMENT_DEPENDENCY_FIELDS = ['devDependencies'];

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

function readWorkspaceManifests(root, patterns) {
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
    .map(normalizeWorkspacePath)
    .filter((directory) => directory && existsSync(path.join(root, directory, 'package.json')))
    .sort();
  const packages = [];
  const names = new Set();
  for (const directory of [...new Set(directories)]) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
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
    if (names.has(name)) throw new Error(`duplicate workspace package name: ${name}`);
    names.add(name);
    packages.push({
      name,
      directory,
      scripts:
        manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
          ? manifest.scripts
          : {},
      productionDependencyNames: manifestDependencyNames(manifest, BUILD_DEPENDENCY_FIELDS),
      developmentDependencyNames: manifestDependencyNames(manifest, DEVELOPMENT_DEPENDENCY_FIELDS),
    });
  }
  if (packages.length === 0) throw new Error('workspace patterns resolved to zero packages');
  return packages;
}

/** Discover all workspace manifests from pnpm's declared globs. */
export function readWorkspaceGraph(root) {
  const patterns = parseWorkspacePatterns(
    readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
  );
  const packages = readWorkspaceManifests(root, patterns);
  const workspaceNames = new Set(packages.map((entry) => entry.name));
  for (const entry of packages) {
    const imports = readWorkspaceImportDependencies(root, entry, workspaceNames);
    entry.buildDependencies = [
      ...new Set([
        ...entry.productionDependencyNames.filter((name) => workspaceNames.has(name)),
        ...imports.production.filter((name) => name !== entry.name),
      ]),
    ].sort();
    entry.typecheckDependencies = imports.production.filter((name) => name !== entry.name).sort();
    entry.testDependencies = imports.verification.filter((name) => name !== entry.name).sort();
    entry.verificationDependencies = [...entry.testDependencies];
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
    packages.map((item) => [item.name, workspaceDependenciesForOperation(item, operation)]),
  );
  const dependents = new Map(packages.map((item) => [item.name, []]));
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
