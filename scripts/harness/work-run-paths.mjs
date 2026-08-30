import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;

export function assertCanonicalRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId) || runId === '.' || runId === '..') {
    throw new Error(
      'invalid work-run run ID; expected only A-Z, a-z, 0-9, dot, underscore or dash',
    );
  }
  return runId;
}

function ownedRelative(ownerDirectory, targetPath, allowOwner = false) {
  const owner = path.resolve(ownerDirectory);
  const target = path.resolve(targetPath);
  const relative = path.relative(owner, target);
  if (
    (!allowOwner && relative === '') ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`work-run path escapes owner directory: ${target}`);
  }
  return { owner, relative, target };
}

function resolveOwnedPath(ownerDirectory, ...parts) {
  return ownedRelative(ownerDirectory, path.resolve(ownerDirectory, ...parts)).target;
}

function assertDirectory(directory) {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error(`work-run path contains symlink: ${directory}`);
  if (!stat.isDirectory())
    throw new Error(`work-run path component is not a directory: ${directory}`);
}

function ensureDirectory(directory) {
  try {
    assertDirectory(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      mkdirSync(directory);
    } catch (mkdirError) {
      if (mkdirError.code !== 'EEXIST') throw mkdirError;
    }
    assertDirectory(directory);
  }
}

function assertRealContainment(owner, directory) {
  const realOwner = realpathSync(owner);
  const realDirectory = realpathSync(directory);
  ownedRelative(realOwner, realDirectory, true);
}

export function ensureOwnedDirectory(ownerDirectory, directory) {
  const { owner, relative, target } = ownedRelative(ownerDirectory, directory, true);
  let current = owner;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    ensureDirectory(current);
  }
  assertRealContainment(owner, target);
  return target;
}

export function assertSafeOwnedParent(ownerDirectory, file) {
  const { target } = ownedRelative(ownerDirectory, file);
  ensureOwnedDirectory(ownerDirectory, path.dirname(target));
  try {
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error(`work-run target is a symlink: ${target}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  assertRealContainment(path.resolve(ownerDirectory), path.dirname(target));
  return target;
}

export function inferWorkRunReceiptOwner(file) {
  const target = path.resolve(file);
  const marker = `${path.sep}.agents${path.sep}evals${path.sep}work-runs${path.sep}`;
  const markerIndex = target.indexOf(marker);
  return markerIndex === -1 ? path.dirname(path.dirname(target)) : target.slice(0, markerIndex);
}

function receiptCoordinates(generation, revision) {
  if (
    !Number.isInteger(generation) ||
    generation < 0 ||
    !Number.isInteger(revision) ||
    revision < 0
  ) {
    throw new Error('work-run receipt coordinates must be nonnegative integers');
  }
  return `g${generation}-r${revision}.json`;
}

export function workRunStatePath(stateDirectory, runId) {
  return resolveOwnedPath(stateDirectory, `${assertCanonicalRunId(runId)}.json`);
}

export function workRunReceiptPath(receiptDirectory, runId, generation, revision) {
  const runDirectory = resolveOwnedPath(receiptDirectory, assertCanonicalRunId(runId));
  return resolveOwnedPath(runDirectory, receiptCoordinates(generation, revision));
}

export function workRunLockPath(lockDirectory, runId) {
  return resolveOwnedPath(lockDirectory, `${assertCanonicalRunId(runId)}.lock`);
}
