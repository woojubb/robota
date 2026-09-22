import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { matchesInput } from './affected-contract-tests.mjs';
import { projectContractInputPath } from './contract-input-matching.mjs';
import {
  CONTRACT_CONTROL_PLANE_INPUTS,
  validateContractInputProjection,
} from './contract-test-inputs.mjs';
import { collectFiles } from './enumerate-files.mjs';
import { envWithoutGitVars } from './shared.mjs';

export const CONTRACT_TEST_CACHE_SCHEMA = 'robota-contract-tests-v3';

export const CONTRACT_TEST_GLOBAL_INPUTS = CONTRACT_CONTROL_PLANE_INPUTS;

const normalizePath = (value) =>
  String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '');

const defaultCacheRoot = (root) => path.join(root, '.cache', 'robota-contract-tests');

const EXECUTION_ENVIRONMENT_KEYS = [
  'COMSPEC',
  'CI',
  'FORCE_COLOR',
  'GITHUB_ACTIONS',
  'HARNESS_CONTRACT_SHARD_TIMEOUT_MS',
  'HOME',
  'ImageOS',
  'ImageVersion',
  'LANG',
  'LC_ALL',
  'NODE_OPTIONS',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'RUNNER_ARCH',
  'RUNNER_OS',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR',
];

function hashPart(hash, label, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${label}\0${bytes.byteLength}\0`);
  hash.update(bytes);
  hash.update('\0');
}

function commandVersion(command, args, runCommand, environment) {
  const result = runCommand(command, args, {
    encoding: 'utf8',
    env: envWithoutGitVars(environment),
  });
  if ((result.status ?? 1) !== 0 || result.signal) {
    throw new Error(`${command} version could not be resolved`);
  }
  const version = String(result.stdout ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!version) throw new Error(`${command} version was empty`);
  return version;
}

/** Resolve every process/tool/runner input that can change a contract verdict outside the tree. */
export function resolveContractExecutionContext({
  environment = process.env,
  nodeVersion = process.version,
  platform = process.platform,
  architecture = process.arch,
  runCommand = spawnSync,
} = {}) {
  return Object.freeze({
    nodeVersion,
    platform,
    architecture,
    gitVersion: commandVersion('git', ['--version'], runCommand, environment),
    bashVersion: commandVersion('bash', ['--version'], runCommand, environment),
    ...Object.fromEntries(
      EXECUTION_ENVIRONMENT_KEYS.map((key) => [`environment.${key}`, environment[key] ?? '']),
    ),
  });
}

function validatedExecutionContext(executionContext) {
  if (
    !executionContext ||
    typeof executionContext !== 'object' ||
    Array.isArray(executionContext)
  ) {
    throw new Error('contract cache execution context is invalid');
  }
  const entries = Object.entries(executionContext).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedKeys = [
    'architecture',
    'bashVersion',
    'gitVersion',
    'nodeVersion',
    'platform',
    ...EXECUTION_ENVIRONMENT_KEYS.map((key) => `environment.${key}`),
  ].sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(entries.map(([key]) => key)) !== JSON.stringify(expectedKeys) ||
    entries.some(([, value]) => typeof value !== 'string') ||
    ['architecture', 'bashVersion', 'gitVersion', 'nodeVersion', 'platform'].some(
      (key) => !executionContext[key].trim(),
    )
  ) {
    throw new Error('contract cache execution context is invalid');
  }
  return entries;
}

function repositoryInputFiles(root, runGit = spawnSync) {
  return collectFiles([], {
    cwd: root,
    run: (args, cwd) => {
      const result = runGit('git', args, { cwd, encoding: 'utf8', env: envWithoutGitVars() });
      if ((result.status ?? 1) !== 0 || result.signal) {
        throw new Error('repository inputs could not be enumerated');
      }
      return String(result.stdout ?? '')
        .split('\0')
        .map(normalizePath)
        .filter(Boolean);
    },
  });
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
  validateContractInputProjection(entry);
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
  const names = new Set();
  const projected =
    entry.projectedInputs ??
    entry.repositoryInputs.map((targetOrPattern) => ({
      targetOrPattern,
      sensitivity: 'content',
    }));
  for (const projection of projected) {
    if (projection.sensitivity === 'execution') continue;
    const input = projection.targetOrPattern;
    const exact =
      entry.projectedInputs !== undefined && !input.includes('*') && !input.includes('?');
    const matchKey = `${exact ? 'exact' : 'population'}:${projection.sensitivity}:${input}`;
    let matches = repositoryMatches.get(matchKey);
    if (!matches) {
      matches = exact
        ? [input]
        : [
            ...new Set(
              trackedFiles
                .map((file) => projectContractInputPath(file, projection))
                .filter((file) => file !== undefined),
            ),
          ];
      repositoryMatches.set(matchKey, matches);
    }
    for (const file of matches) {
      if (projection.sensitivity === 'name-set') names.add(file);
      else repository.add(file);
    }
  }
  return { implementation, repository: [...repository].sort(), names: [...names].sort() };
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
  executionContext = resolveContractExecutionContext(),
  runGit,
  contentDigests = new Map(),
  repositoryMatches = new Map(),
}) {
  if (entry.always) throw new Error(`always-run contract test is not cacheable: ${entry.test}`);
  if (entry.cacheable === false) throw new Error(`contract test is not cacheable: ${entry.test}`);
  const tracked = trackedFiles ?? repositoryInputFiles(root, runGit);
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
  for (const [name, value] of validatedExecutionContext(executionContext)) {
    hashPart(hash, `execution-context:${name}`, value);
  }
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
  for (const file of inputs.names) hashPart(hash, 'name-set-path', file);
  for (const projection of entry.projectedInputs ?? []) {
    hashPart(hash, 'projection', `${projection.sensitivity}:${projection.targetOrPattern}`);
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
  executionContext,
  runGit,
}) {
  const byTest = new Map(entries.map((entry) => [normalizePath(entry.test), entry]));
  let trackedFiles;
  try {
    trackedFiles = repositoryInputFiles(root, runGit);
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
  let resolvedExecutionContext;
  try {
    resolvedExecutionContext = executionContext ?? resolveContractExecutionContext();
    validatedExecutionContext(resolvedExecutionContext);
  } catch {
    return {
      cacheRoot,
      hits: [],
      misses: tests.map(normalizePath),
      records: new Map(),
    };
  }

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
        executionContext: resolvedExecutionContext,
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
