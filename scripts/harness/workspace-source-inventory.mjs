import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { GENERATION_DIRECTORY, validateOutputName } from '../artifacts/writer-lock.mjs';

import { collectFiles } from './enumerate-files.mjs';
import { isRepositoryPath } from './workspace-source-config-resolution.mjs';

// The existing source reader's exclusions, shared with filesystem traversal so generated trees
// are rejected before enumeration, not only after their entire contents have been listed.
export const WORKSPACE_SOURCE_EXCLUSIONS = Object.freeze({
  directoryNames: Object.freeze([
    'node_modules',
    'dist',
    'coverage',
    '.next',
    '.turbo',
    GENERATION_DIRECTORY,
  ]),
  packageRootDirectoryNames: Object.freeze(['out']),
});

function populationCategory(relative) {
  const name = path.posix.basename(relative);
  if (
    name === 'package.json' ||
    /^tsconfig(?:\.[\w-]+)?\.json$/u.test(name) ||
    name === 'pnpm-workspace.yaml'
  )
    return 'config';
  if (/\.(?:png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/u.test(name)) return 'asset';
  if (/\.[cm]?[jt]sx?$/u.test(name)) return 'source';
  if (/\.(?:md|mdx)$/u.test(name)) return 'documentation';
  if (/\.(?:json|jsonl|ndjson|ya?ml|csv|tsv|txt)$/u.test(name)) return 'data';
  return 'unknown';
}

function categoryReason(relative, category) {
  if (category === 'unknown') return 'unrecognized-file-kind:requires-classification';
  if (category === 'config') return `configuration-name:${path.posix.basename(relative)}`;
  return `${category}-extension:${path.posix.extname(relative)}`;
}

function filesystemPaths(root, packages, stat, readDirectory) {
  const outputs = new Set([
    ...WORKSPACE_SOURCE_EXCLUSIONS.packageRootDirectoryNames,
    ...packages.flatMap((entry) =>
      WORKSPACE_SOURCE_EXCLUSIONS.packageRootDirectoryNames.map(
        (name) => `${entry.directory}/${name}`,
      ),
    ),
    ...packages
      .filter((entry) => entry.artifact)
      .flatMap((entry) => [
        `${entry.directory}/${validateOutputName()}`,
        ...Object.values(entry.artifact.variants ?? {}).map(
          (variant) => `${entry.directory}/${validateOutputName(variant.output)}`,
        ),
      ]),
  ]);
  const files = [];
  function visit(relative) {
    const absolute = path.join(root, relative);
    const info = stat(absolute);
    if (info.isSymbolicLink()) {
      if (!relative) throw new Error('filesystem inventory root must not be a symlink');
      files.push(relative);
      return;
    }
    if (!info.isDirectory()) {
      files.push(relative);
      return;
    }
    for (const name of [...readDirectory(absolute)].sort()) {
      if (name === '.git' || WORKSPACE_SOURCE_EXCLUSIONS.directoryNames.includes(name)) continue;
      const file = relative ? `${relative}/${name}` : name;
      if (!isRepositoryPath(file) || name.includes('/') || name.includes('\\'))
        throw new Error(`invalid filesystem inventory entry: ${file}`);
      if (!outputs.has(file)) visit(file);
    }
  }
  visit('');
  return files.sort();
}

/**
 * Population accounting, not a semantic declaration that a file is valid shared material.
 * `population` is tracked; `untrackedPopulation` is the separate nonignored increment.
 * `files` contains regular files from both, including declared generated outputs: a category
 * does not silently remove a resolution target. Contract pointers identify existing declarations,
 * not reviewed neutrality or independent-consumer evidence. Unknown kinds remain explicit.
 * Workspace roots and artifact capabilities come from the existing graph, never rediscovery here.
 * Explicit filesystem mode has its own population (not Git tracked/untracked coverage). It
 * excludes dependency storage, Git metadata and declared artifact output trees before traversal;
 * it does not claim Git-ignore filtering and never acts as a fallback for Git collection errors.
 */
export function collectWorkspaceSourceInventory(
  root,
  {
    packages,
    mode = 'git',
    collect = collectFiles,
    stat = lstatSync,
    readDirectory = readdirSync,
  } = {},
) {
  if (!['git', 'filesystem'].includes(mode)) throw new Error(`invalid inventory mode: ${mode}`);
  const tracked =
    mode === 'git' ? [...new Set(collect([], { cwd: root, includeUntracked: false }))].sort() : [];
  const trackedSet = new Set(tracked);
  const all =
    mode === 'git'
      ? [...new Set([...tracked, ...collect([], { cwd: root, includeUntracked: true })])].sort()
      : filesystemPaths(root, packages, stat, readDirectory);
  const owners = [...packages].sort((a, b) => b.directory.length - a.directory.length);
  const files = new Set();
  const entries = all.map((relative) => {
    const owner =
      owners.find((entry) => relative.startsWith(`${entry.directory}/`))?.name ?? 'repository';
    const identity = { path: relative, owner };
    if (!isRepositoryPath(relative)) {
      return { ...identity, category: 'unknown', reason: 'path-outside-repository' };
    }
    let info;
    try {
      const segments = relative.split('/');
      for (let count = 1; count <= segments.length; count += 1) {
        info = stat(path.join(root, ...segments.slice(0, count)));
        if (info.isSymbolicLink())
          return { ...identity, category: 'symlink', reason: 'not-followed' };
      }
    } catch (error) {
      if (mode === 'filesystem' || error.code !== 'ENOENT') throw error;
      return { ...identity, category: 'missing', reason: 'pending-deletion-or-missing' };
    }
    if (!info.isFile()) return { ...identity, category: 'non-file', reason: 'not-a-regular-file' };
    files.add(relative);
    const category = populationCategory(relative);
    return { ...identity, category, reason: categoryReason(relative, category) };
  });
  for (const entry of entries) {
    const owner = owners.find((candidate) => candidate.name === entry.owner);
    const declarations = owner
      ? [
          'pnpm-workspace.yaml',
          `${owner.directory}/package.json`,
          `${owner.directory}/docs/SPEC.md`,
        ]
      : ['package.json', '.agents/project-structure.md'];
    entry.contractEvidence = declarations.filter((file) => files.has(file));
    if (owner?.artifact && files.has(entry.path) && files.has(`${owner.directory}/package.json`)) {
      const outputs = [
        validateOutputName(),
        ...Object.values(owner.artifact.variants ?? {}).map((variant) => variant.output),
      ];
      if (outputs.some((output) => entry.path.startsWith(`${owner.directory}/${output}/`))) {
        entry.category = 'generated';
        entry.reason = 'declared-workspace-artifact-output';
        entry.contractEvidence.push(`${owner.directory}/package.json#robota.artifact`);
      }
    }
  }
  if (mode === 'filesystem') return { mode, filesystemPopulation: entries, files };
  return {
    mode,
    population: entries.filter((entry) => trackedSet.has(entry.path)),
    untrackedPopulation: entries.filter((entry) => !trackedSet.has(entry.path)),
    files,
  };
}
