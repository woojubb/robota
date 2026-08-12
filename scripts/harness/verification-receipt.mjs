import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_FILE = 'robota-verification/verify-like-ci.json';
const OWNER_FILES = [
  '.github/workflows/ci.yml',
  '.lintstagedrc.json',
  'package.json',
  'scripts/harness/with-repo-lock.sh',
];

function normalizedIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const scalarFields = [
    'headCommit',
    'headTree',
    'baseCommit',
    'profile',
    'nodeVersion',
    'pnpmVersion',
    'lockfileHash',
    'ownerFingerprint',
  ];
  if (scalarFields.some((field) => typeof identity[field] !== 'string' || !identity[field])) {
    return null;
  }
  if (
    !Array.isArray(identity.stages) ||
    identity.stages.some((stage) => typeof stage !== 'string')
  ) {
    return null;
  }
  return Object.fromEntries([
    ...scalarFields.map((field) => [field, identity[field]]),
    ['stages', [...identity.stages]],
  ]);
}

export function createVerificationReceipt(identity, verifiedAt = new Date().toISOString()) {
  const normalized = normalizedIdentity(identity);
  if (!normalized)
    throw new Error('Cannot create a verification receipt from an invalid identity.');
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    status: 'pass',
    verifiedAt,
    identity: normalized,
  };
}

export function receiptMatches(receipt, expectedIdentity) {
  if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.status !== 'pass') {
    return false;
  }
  const actual = normalizedIdentity(receipt.identity);
  const expected = normalizedIdentity(expectedIdentity);
  return Boolean(actual && expected && JSON.stringify(actual) === JSON.stringify(expected));
}

export function shouldWriteFullReceipt({ exitCode, clean, selectedStages, requiredStages }) {
  return (
    exitCode === 0 &&
    clean === true &&
    Array.isArray(selectedStages) &&
    Array.isArray(requiredStages) &&
    JSON.stringify(selectedStages) === JSON.stringify(requiredStages)
  );
}

function run(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr?.trim()}`);
  }
  return result.stdout.trim();
}

function listOwnerFiles(root) {
  const files = [...OWNER_FILES];
  const harnessRoot = path.join(root, 'scripts/harness');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith('.mjs')) files.push(path.relative(root, absolute));
    }
  };
  walk(harnessRoot);
  return [...new Set(files)].sort();
}

function hashFiles(root, files) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path.join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function isCleanTree(root) {
  return run('git', ['status', '--porcelain', '--untracked-files=all'], root) === '';
}

export function verificationReceiptPath(root) {
  const commonDir = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root);
  return path.join(commonDir, RECEIPT_FILE);
}

export function computeVerificationIdentity({ baseRef, stages, root }) {
  return {
    headCommit: run('git', ['rev-parse', 'HEAD^{commit}'], root),
    headTree: run('git', ['rev-parse', 'HEAD^{tree}'], root),
    baseCommit: run('git', ['rev-parse', `${baseRef}^{commit}`], root),
    profile: 'verify-like-ci/full',
    stages: [...stages],
    nodeVersion: process.version,
    pnpmVersion: run('pnpm', ['--version'], root),
    lockfileHash: hashFiles(root, ['pnpm-lock.yaml']),
    ownerFingerprint: hashFiles(root, listOwnerFiles(root)),
  };
}

export function readVerificationReceipt(root) {
  try {
    return JSON.parse(readFileSync(verificationReceiptPath(root), 'utf8'));
  } catch {
    return null;
  }
}

export function writeVerificationReceipt({ baseRef, stages, root }) {
  if (!isCleanTree(root)) return { written: false, reason: 'working tree is not clean' };
  const target = verificationReceiptPath(root);
  const receipt = createVerificationReceipt(computeVerificationIdentity({ baseRef, stages, root }));
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
  return { written: true, target, receipt };
}

export function pushedObjectsMatchVerifiedHead(updates, headCommit) {
  return (updates ?? [])
    .filter((update) => update.localRef !== '(delete)' && !/^0{40,64}$/u.test(update.localObjectId))
    .every((update) => update.localObjectId === headCommit);
}

export function findReusableVerification({ baseRef, stages, updates, root }) {
  try {
    if (!isCleanTree(root)) return { reusable: false, reason: 'working tree is not clean' };
    const expected = computeVerificationIdentity({ baseRef, stages, root });
    if (!pushedObjectsMatchVerifiedHead(updates, expected.headCommit)) {
      return { reusable: false, reason: 'pushed object differs from verified HEAD' };
    }
    const receipt = readVerificationReceipt(root);
    return receiptMatches(receipt, expected)
      ? { reusable: true, headCommit: expected.headCommit }
      : { reusable: false, reason: 'no exact full-gate receipt' };
  } catch (error) {
    return { reusable: false, reason: error?.message ?? String(error) };
  }
}

function argValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  const baseRefIndex = process.argv.indexOf('--base-ref');
  const baseRef = baseRefIndex >= 0 ? process.argv[baseRefIndex + 1] : null;
  const stages = argValues(process.argv.slice(2), '--stage');
  if (!baseRef || stages.length === 0) {
    process.stderr.write('usage: verification-receipt.mjs --base-ref <ref> --stage <name>...\n');
    process.exitCode = 2;
  } else {
    const result = writeVerificationReceipt({ baseRef, stages, root: process.cwd() });
    process.stdout.write(
      result.written
        ? `verification receipt written: ${result.target}\n`
        : `verification receipt not written: ${result.reason}\n`,
    );
    if (!result.written) process.exitCode = 1;
  }
}
