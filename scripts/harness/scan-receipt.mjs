/** Content-addressed success markers for explicitly audited repository scans. */

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { isCleanTree } from './verification-receipt-storage.mjs';

export const SCAN_SUCCESS_CACHE_SCHEMA = 'robota-scan-success-v2';

const SCAN_SUCCESS_ENVIRONMENT_KEYS = [
  'CI',
  'COMSPEC',
  'FORCE_COLOR',
  'GITHUB_ACTIONS',
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

/**
 * Scans whose inputs are NOT wholly represented by the tree, so a tree hash cannot speak for them.
 * Named, not inferred: a scan added later that reads build output, commit metadata, or live external
 * state must be added here in the same change, and the test asserting it is re-run on a hit is what
 * makes that visible.
 */
export const TREE_EXTERNAL_SCANS = new Set(['action-references', 'build-contracts', 'dist']);

function run(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr?.trim() ?? ''}`);
  }
  return result.stdout.trim();
}

function hashFile(root, relativePath) {
  try {
    return createHash('sha256')
      .update(readFileSync(path.join(root, relativePath)))
      .digest('hex');
  } catch {
    return 'absent';
  }
}

function scanSuccessBaseIdentity(root) {
  const runnerEnvironment = Object.fromEntries(
    SCAN_SUCCESS_ENVIRONMENT_KEYS.map((key) => [key, process.env[key] ?? '']),
  );
  return {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    pnpmVersion: run('pnpm', ['--version'], root),
    gitVersion: run('git', ['--version'], root),
    bashVersion: run('bash', ['--version'], root).split(/\r?\n/u)[0],
    lockfileHash: hashFile(root, 'pnpm-lock.yaml'),
    runnerEnvironment,
  };
}

function normalizedScanSuccessIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  const scalars = [
    'nodeVersion',
    'platform',
    'architecture',
    'pnpmVersion',
    'gitVersion',
    'bashVersion',
    'lockfileHash',
  ];
  if (scalars.some((field) => typeof identity[field] !== 'string' || !identity[field])) return null;
  const runnerEnvironment = identity.runnerEnvironment;
  const runnerKeys = SCAN_SUCCESS_ENVIRONMENT_KEYS;
  if (
    !runnerEnvironment ||
    typeof runnerEnvironment !== 'object' ||
    Array.isArray(runnerEnvironment) ||
    JSON.stringify(Object.keys(runnerEnvironment).sort()) !== JSON.stringify(runnerKeys.sort()) ||
    runnerKeys.some((key) => typeof runnerEnvironment[key] !== 'string')
  ) {
    return null;
  }
  return {
    ...Object.fromEntries(scalars.map((field) => [field, identity[field]])),
    runnerEnvironment: Object.fromEntries(runnerKeys.map((key) => [key, runnerEnvironment[key]])),
  };
}

function normalizedScanInputs(root, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const patterns = [...new Set(input.patterns ?? [])].sort();
  const files = [...new Set(input.files ?? [])].sort();
  if (
    patterns.some((value) => typeof value !== 'string' || !value) ||
    files.some((value) => typeof value !== 'string' || !value)
  ) {
    return null;
  }
  const digests = files.map((file) => {
    const absolute = path.join(root, file);
    const stat = lstatSync(absolute);
    const content = stat.isSymbolicLink()
      ? `symlink:${readlinkSync(absolute)}`
      : readFileSync(absolute);
    return [file, createHash('sha256').update(content).digest('hex')];
  });
  return { patterns, files: digests };
}

function scanSuccessKey(identity, scanName, context, command, inputs) {
  const normalizedIdentity = normalizedScanSuccessIdentity(identity);
  if (!normalizedIdentity || typeof scanName !== 'string' || !scanName.trim()) {
    throw new Error('Cannot create a scan-success key from invalid identity.');
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        schema: SCAN_SUCCESS_CACHE_SCHEMA,
        scan: scanName,
        context,
        command,
        identity: normalizedIdentity,
        inputs,
      }),
    )
    .digest('hex');
}

function scanSuccessMarkerPath(cacheRoot, key) {
  return path.join(cacheRoot, key.slice(0, 2), `${key}.json`);
}

function scanSuccessMarker(record, output) {
  return {
    schema: SCAN_SUCCESS_CACHE_SCHEMA,
    key: record.key,
    scan: record.scan,
    context: record.context,
    result: 'pass',
    output,
  };
}

/**
 * Read independently proven per-scan successes. A missing/corrupt marker, dirty tree, side-effecting
 * adoption run, or tree-external scan is always a miss.
 */
export function inspectScanSuccessCache({
  scanNames,
  cacheableScanNames = [],
  scanInputs = new Map(),
  scanCommands = new Map(),
  root,
  context,
  cacheRoot = path.join(root, '.cache', 'robota-scan-successes'),
  identity,
  clean,
  writeAdoption = false,
}) {
  const names = [...new Set(scanNames)];
  const cacheable = new Set(cacheableScanNames);
  const misses = [];
  const hits = new Map();
  const records = new Map();
  if (writeAdoption) {
    return { cacheRoot, hits, misses: names, records, reason: 'adoption re-freeze requested' };
  }
  const eligible = clean ?? isCleanTree(root);
  if (!eligible) {
    return { cacheRoot, hits, misses: names, records, reason: 'working tree is not clean' };
  }

  let baseIdentity;
  try {
    baseIdentity = normalizedScanSuccessIdentity(identity ?? scanSuccessBaseIdentity(root));
    if (!baseIdentity) throw new Error('invalid scan-success identity');
  } catch {
    return { cacheRoot, hits, misses: names, records, reason: 'execution identity unavailable' };
  }

  for (const scan of names) {
    if (!cacheable.has(scan) || TREE_EXTERNAL_SCANS.has(scan)) {
      misses.push(scan);
      continue;
    }
    let inputs;
    try {
      inputs = normalizedScanInputs(root, scanInputs.get(scan));
      if (!inputs) throw new Error('invalid scan inputs');
    } catch {
      misses.push(scan);
      continue;
    }
    const command = scanCommands.get(scan);
    if (!Array.isArray(command) || command.some((part) => typeof part !== 'string')) {
      misses.push(scan);
      continue;
    }
    const key = scanSuccessKey(baseIdentity, scan, context, command, inputs);
    const record = {
      scan,
      context,
      key,
      file: scanSuccessMarkerPath(cacheRoot, key),
    };
    records.set(scan, record);
    try {
      if (!existsSync(record.file)) throw new Error('missing');
      const marker = JSON.parse(readFileSync(record.file, 'utf8'));
      if (
        JSON.stringify(marker) !==
        JSON.stringify(scanSuccessMarker(record, String(marker?.output ?? '')))
      ) {
        throw new Error('invalid');
      }
      hits.set(scan, { code: 0, output: marker.output });
    } catch {
      misses.push(scan);
    }
  }
  return {
    cacheRoot,
    hits,
    misses,
    records,
    reason: hits.size > 0 ? `${hits.size} independently proven success(es)` : 'no matching success',
  };
}

function writeScanSuccessMarker(record, output) {
  mkdirSync(path.dirname(record.file), { recursive: true });
  const temporary = `${record.file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(scanSuccessMarker(record, output))}\n`, {
      flag: 'wx',
    });
    renameSync(temporary, record.file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Persist each clean raw pass even when a sibling failed, was cancelled, or was unavailable. */
export function recordSuccessfulScanResults({ cache, results, warn = console.warn }) {
  let recorded = 0;
  for (const result of results) {
    if (result.code !== 0 || result.unavailable) continue;
    const record = cache.records.get(result.name);
    if (!record) continue;
    try {
      writeScanSuccessMarker(record, String(result.output ?? ''));
      recorded += 1;
    } catch (error) {
      warn(`[harness-scan] success cache write failed for ${result.name}: ${error.message}`);
    }
  }
  return recorded;
}

/** Keep cached scans in the aggregate verdict while replacing only their expensive execution. */
export function applyScanSuccessCache(scans, cache) {
  return scans.map((scan) => {
    const cached = cache.hits.get(scan.name);
    return cached ? { ...scan, run: () => Promise.resolve(cached), cached: true } : scan;
  });
}
