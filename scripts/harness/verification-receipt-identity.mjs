import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { release } from 'node:os';
import path from 'node:path';

import { runVerificationCommand } from './verification-receipt-command.mjs';

const RECEIPT_SCHEMA_VERSION = 1;
const IDENTITY_COMMAND_BUDGET = 12;
const IDENTITY_DEADLINE_MS = 15_000;
const MAX_TOOL_BYTES = 64 * 1024 * 1024;
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
    'platform',
    'architecture',
    'osRelease',
    'gitIdentity',
    'awkIdentity',
    'realpathIdentity',
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
  if (!normalized) {
    throw new Error('Cannot create a verification receipt from an invalid identity.');
  }
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

function listOwnerFiles(root) {
  const files = [...OWNER_FILES];
  const directories = [path.join(root, 'scripts/harness')];
  while (directories.length > 0) {
    const directory = directories.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(absolute);
      else if (entry.name.endsWith('.mjs')) files.push(path.relative(root, absolute));
    }
  }
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

function createCommandBudget() {
  return {
    deadline: Date.now() + IDENTITY_DEADLINE_MS,
    remaining: IDENTITY_COMMAND_BUDGET,
  };
}

function runBounded(budget, command, args, root) {
  const timeoutMs = Math.min(5_000, budget.deadline - Date.now());
  if (budget.remaining <= 0) throw new Error('verification identity command budget exhausted');
  if (timeoutMs <= 0) throw new Error('verification identity command deadline exceeded');
  budget.remaining -= 1;
  return runVerificationCommand(command, args, root, { timeoutMs });
}

export function executableFingerprint(
  executable,
  io = { closeSync, fstatSync, openSync, readFileSync, realpathSync },
) {
  const canonicalPath = io.realpathSync(executable);
  const descriptor = io.openSync(canonicalPath, 'r');
  try {
    const stat = io.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_TOOL_BYTES) {
      throw new Error(`verification identity tool is not a bounded regular file: ${canonicalPath}`);
    }
    return {
      path: canonicalPath,
      sha256: createHash('sha256').update(io.readFileSync(descriptor)).digest('hex'),
    };
  } finally {
    io.closeSync(descriptor);
  }
}

function resolveExecutable(budget, command, root) {
  const resolved = runBounded(
    budget,
    '/bin/sh',
    ['-c', 'command -v "$1"', 'verification-receipt', command],
    root,
  );
  if (!path.isAbsolute(resolved) || resolved.includes('\n')) {
    throw new Error(`verification identity could not resolve one absolute ${command} executable`);
  }
  return executableFingerprint(resolved);
}

function toolIdentity(budget, command, probeArgs, root, probeField) {
  const executable = resolveExecutable(budget, command, root);
  const probe = runBounded(budget, executable.path, probeArgs, root);
  if (!probe) throw new Error(`verification identity ${command} probe returned no implementation`);
  return JSON.stringify({ ...executable, [probeField]: probe });
}

export function computeVerificationIdentity({ baseRef, stages, root, headRef = 'HEAD' }) {
  const budget = createCommandBudget();
  const git = resolveExecutable(budget, 'git', root);
  const gitVersion = runBounded(budget, git.path, ['--version'], root);
  const headCommit = runBounded(budget, git.path, ['rev-parse', `${headRef}^{commit}`], root);
  return {
    headCommit,
    headTree: runBounded(budget, git.path, ['rev-parse', `${headCommit}^{tree}`], root),
    baseCommit: runBounded(budget, git.path, ['rev-parse', `${baseRef}^{commit}`], root),
    profile: 'verify-like-ci/full',
    stages: [...stages],
    nodeVersion: process.version,
    pnpmVersion: runBounded(budget, 'pnpm', ['--version'], root),
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
    gitIdentity: JSON.stringify({ ...git, version: gitVersion }),
    awkIdentity: toolIdentity(
      budget,
      'awk',
      ['BEGIN { print "verification-receipt-awk-v1" }'],
      root,
      'probe',
    ),
    realpathIdentity: toolIdentity(budget, 'realpath', ['/'], root, 'probe'),
    lockfileHash: hashFiles(root, ['pnpm-lock.yaml']),
    ownerFingerprint: hashFiles(root, listOwnerFiles(root)),
  };
}
