import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateWorkRunReceipt } from './work-run-receipt-validation.mjs';
import { receiptPathCoordinates } from './work-run-validation-foundation.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 1024 * 1024;

function gitOutput(root, args, options) {
  const result = (options.run ?? spawnSync)('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('work-run receipt correlation could not inspect merge parent objects');
  }
  return result.stdout.trim();
}

function inheritedMergeReceipts(root, changes, options) {
  const mergeFile = gitOutput(root, ['rev-parse', '--git-path', 'MERGE_HEAD'], options);
  let text;
  try {
    text = readFileSync(resolve(root, mergeFile), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw new Error('work-run receipt correlation could not read MERGE_HEAD');
  }
  const parents = text.trim().split(/\s+/);
  if (!parents.every((oid) => /^[0-9a-f]{40,64}$/.test(oid))) {
    throw new Error('work-run receipt correlation found invalid MERGE_HEAD');
  }
  parents.unshift(gitOutput(root, ['rev-parse', '--verify', 'HEAD'], options));
  const inherited = new Set();
  for (const { file, status } of changes) {
    if (!receiptPathCoordinates(file) || !['A', 'M'].includes(status)) continue;
    const index = gitOutput(root, ['ls-files', '--stage', '--', file], options);
    const match = /^(\d{6}) ([0-9a-f]+) 0\t/.exec(index);
    if (!match || index.includes('\n')) throw new Error('invalid staged receipt object');
    // Read every parent even after a match: an unreadable parent must not be silently trusted.
    const entries = parents.map((parent) =>
      gitOutput(root, ['ls-tree', parent, '--', file], options),
    );
    if (entries.some((entry) => entry === `${match[1]} blob ${match[2]}\t${file}`))
      inherited.add(file);
  }
  return inherited;
}

function stagedChanges(root, options) {
  const result = (options.run ?? spawnSync)(
    'git',
    ['diff', '--cached', '--name-status', '-z', '--no-renames'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    },
  );
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('work-run receipt correlation could not inspect the staged closure');
  }
  const fields = result.stdout.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 2 !== 0) {
    throw new Error('work-run receipt correlation received an invalid staged change list');
  }
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({ status: fields[index], file: fields[index + 1] });
  }
  return changes;
}

function stagedReceipt(root, file, options) {
  const result = (options.run ?? spawnSync)('git', ['show', `:${file}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('pending work-run receipt could not be read from the staged closure');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('pending work-run receipt is not valid staged JSON');
  }
}

export function pendingTerminalReceiptCorrelation(root, options = {}) {
  const changes = stagedChanges(root, options);
  if (!changes.some(({ file }) => receiptPathCoordinates(file))) return null;
  const inherited = inheritedMergeReceipts(root, changes, options);
  const receiptChanges = changes.filter(
    ({ file }) => receiptPathCoordinates(file) && !inherited.has(file),
  );
  if (receiptChanges.length === 0) return null;
  if (receiptChanges.length !== 1) {
    throw new Error('ambiguous work-run receipt closure; expected exactly one pending receipt');
  }
  if (changes.length !== 1 || receiptChanges[0].status !== 'A') {
    throw new Error('work-run receipt closure must add exactly one staged receipt path');
  }
  const [{ file }] = receiptChanges;
  const coordinates = receiptPathCoordinates(file);
  const receipt = stagedReceipt(root, file, options);
  const verdict = validateWorkRunReceipt(receipt, { receiptPath: file });
  const terminalDisposition =
    verdict.ok &&
    (['included', 'excluded'].includes(verdict.receipt.disposition) ||
      (verdict.receipt.disposition === 'invalid' && verdict.receipt.reason === 'state-lost'));
  if (!terminalDisposition) {
    throw new Error(
      `pending work-run receipt is not a valid terminal receipt: ${verdict.reason ?? 'unsupported disposition'}`,
    );
  }
  return {
    runId: coordinates.runId,
    receipt: `g${coordinates.generation}-r${coordinates.revision}`,
  };
}
