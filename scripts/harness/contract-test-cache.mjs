import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { matchesInput } from './affected-contract-tests.mjs';
import { CONTRACT_CONTROL_PLANE_INPUTS } from './contract-test-inputs.mjs';

export const CONTRACT_TEST_CACHE_SCHEMA = 'robota-contract-tests-v1';

export const CONTRACT_TEST_GLOBAL_INPUTS = CONTRACT_CONTROL_PLANE_INPUTS;

const normalizePath = (value) =>
  String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '');

const defaultCacheRoot = (root) => path.join(root, '.cache', 'robota-contract-tests');

function hashPart(hash, label, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${label}\0${bytes.byteLength}\0`);
  hash.update(bytes);
  hash.update('\0');
}

function trackedRepositoryFiles(root, runGit = spawnSync) {
  const result = runGit('git', ['ls-files', '--cached', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  if ((result.status ?? 1) !== 0 || result.signal) {
    throw new Error('tracked repository inputs could not be enumerated');
  }
  return String(result.stdout ?? '')
    .split('\0')
    .map(normalizePath)
    .filter(Boolean)
    .sort();
}

function validatedInputFiles(root, entry, trackedFiles, repositoryMatches = new Map()) {
  if (
    !entry ||
    typeof entry.test !== 'string' ||
    !Array.isArray(entry.implementationInputs) ||
    !Array.isArray(entry.repositoryInputs)
  ) {
    throw new Error('contract cache received invalid registry metadata');
  }
  const implementation = [...new Set(entry.implementationInputs.map(normalizePath))].sort();
  if (
    implementation.length !== entry.implementationInputs.length ||
    implementation.some((file) => !file)
  ) {
    throw new Error(`contract cache received invalid implementation inputs for ${entry.test}`);
  }
  for (const file of implementation) {
    if (!existsSync(path.join(root, file))) {
      throw new Error(`contract cache implementation input is missing: ${file}`);
    }
  }
  const repository = new Set();
  for (const input of entry.repositoryInputs) {
    let matches = repositoryMatches.get(input);
    if (!matches) {
      matches = trackedFiles.filter((file) => matchesInput(file, input));
      repositoryMatches.set(input, matches);
    }
    for (const file of matches) repository.add(file);
  }
  return { implementation, repository: [...repository].sort() };
}

function contentDigest(root, file, digests) {
  let digest = digests.get(file);
  if (!digest) {
    digest = createHash('sha256')
      .update(readFileSync(path.join(root, file)))
      .digest('hex');
    digests.set(file, digest);
  }
  return digest;
}

/** Build a per-test key only from execution identity and the bytes that can affect its verdict. */
export function createContractTestCacheKey({
  root,
  entry,
  trackedFiles,
  globalInputs = CONTRACT_TEST_GLOBAL_INPUTS,
  nodeMajor = process.versions.node.split('.')[0],
  platform = process.platform,
  runGit,
  contentDigests = new Map(),
  repositoryMatches = new Map(),
}) {
  if (entry.always) throw new Error(`always-run contract test is not cacheable: ${entry.test}`);
  const tracked = trackedFiles ?? trackedRepositoryFiles(root, runGit);
  const inputs = validatedInputFiles(root, entry, tracked, repositoryMatches);
  const globalPatterns = [...new Set(globalInputs.map(normalizePath))].sort();
  if (globalPatterns.length !== globalInputs.length || globalPatterns.some((file) => !file)) {
    throw new Error('contract cache global inputs are invalid');
  }
  const globals = new Set();
  for (const pattern of globalPatterns) {
    const matches =
      pattern.includes('*') || pattern.includes('?')
        ? tracked.filter((file) => matchesInput(file, pattern))
        : [pattern];
    if (matches.length === 0) {
      throw new Error(`contract cache control-plane input did not resolve: ${pattern}`);
    }
    for (const file of matches) globals.add(file);
  }

  const hash = createHash('sha256');
  hashPart(hash, 'schema', CONTRACT_TEST_CACHE_SCHEMA);
  hashPart(hash, 'test', normalizePath(entry.test));
  hashPart(hash, 'node-major', nodeMajor);
  hashPart(hash, 'platform', platform);
  for (const [kind, files] of [
    ['implementation', inputs.implementation],
    ['repository', inputs.repository],
    ['global', [...globals].sort()],
  ]) {
    for (const file of files) {
      const absolute = path.join(root, file);
      if (!existsSync(absolute))
        throw new Error(`contract cache ${kind} input is missing: ${file}`);
      hashPart(hash, `${kind}-path`, file);
      hashPart(hash, `${kind}-contents-sha256`, contentDigest(root, file, contentDigests));
    }
  }
  for (const pattern of [...entry.repositoryInputs].sort()) {
    hashPart(hash, 'repository-pattern', normalizePath(pattern));
  }
  for (const pattern of globalPatterns) hashPart(hash, 'global-pattern', pattern);
  return hash.digest('hex');
}

function markerPath(cacheRoot, key) {
  return path.join(cacheRoot, key.slice(0, 2), `${key}.json`);
}

function expectedMarker(entry, key) {
  return {
    schema: CONTRACT_TEST_CACHE_SCHEMA,
    key,
    test: normalizePath(entry.test),
    result: 'pass',
  };
}

/** Corrupt, stale, missing, and always-run entries are misses by construction. */
export function inspectContractTestCache({
  root,
  entries,
  tests,
  cacheRoot = defaultCacheRoot(root),
  globalInputs,
  nodeMajor,
  platform,
  runGit,
}) {
  const byTest = new Map(entries.map((entry) => [normalizePath(entry.test), entry]));
  let trackedFiles;
  try {
    trackedFiles = trackedRepositoryFiles(root, runGit);
  } catch {
    return {
      cacheRoot,
      hits: [],
      misses: tests.map(normalizePath),
      records: new Map(),
    };
  }
  const hits = [];
  const misses = [];
  const records = new Map();
  const contentDigests = new Map();
  const repositoryMatches = new Map();

  for (const test of tests.map(normalizePath)) {
    const entry = byTest.get(test);
    if (!entry || entry.always) {
      misses.push(test);
      continue;
    }
    try {
      const key = createContractTestCacheKey({
        root,
        entry,
        trackedFiles,
        globalInputs,
        nodeMajor,
        platform,
        contentDigests,
        repositoryMatches,
      });
      const file = markerPath(cacheRoot, key);
      records.set(test, { entry, key, file });
      if (!existsSync(file)) {
        misses.push(test);
        continue;
      }
      const marker = JSON.parse(readFileSync(file, 'utf8'));
      if (JSON.stringify(marker) !== JSON.stringify(expectedMarker(entry, key))) {
        misses.push(test);
        continue;
      }
      hits.push(test);
    } catch {
      misses.push(test);
    }
  }
  return { cacheRoot, hits, misses, records };
}

function writeMarkerAtomically(file, marker) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(marker)}\n`, { flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Record only a cleanly successful shard; cache I/O can never change the test verdict. */
export function recordSuccessfulContractShard({ cache, files, result, warn = console.warn }) {
  if ((result?.status ?? 1) !== 0 || result?.signal) return 0;
  let recorded = 0;
  for (const test of files.map(normalizePath)) {
    const record = cache.records.get(test);
    if (!record) continue;
    try {
      writeMarkerAtomically(record.file, expectedMarker(record.entry, record.key));
      recorded += 1;
    } catch (error) {
      warn(`[contract-tests] cache write failed for ${test}: ${error.message}`);
    }
  }
  return recorded;
}
