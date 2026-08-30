import { existsSync, opendirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { projectLocalTerminalWorkRun, WORK_RUN_LOCAL_DIR } from './work-run-store.mjs';
import { validateWorkRunReceipt } from './work-run-validation.mjs';
import { normalizeWorkRunReceipt } from './work-run-report-metrics.mjs';

const KIBIBYTE = 1024;
const DEFAULT_MAX_FILES = 10_000;
// eslint-disable-next-line no-magic-numbers -- traversal policy permits 64 nested directories
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_ENTRIES = 100_000;
const DEFAULT_MAX_BYTES = KIBIBYTE * KIBIBYTE;
// eslint-disable-next-line no-magic-numbers -- aggregate reads may consume at most 64 MiB
const DEFAULT_MAX_TOTAL_BYTES = 64 * KIBIBYTE * KIBIBYTE;

function reportIssue(disposition, reason, sourcePath) {
  return {
    disposition,
    reason,
    reportIssue: true,
    ...(sourcePath ? { sourcePath } : {}),
  };
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function processEntry(current, entry, state, limits) {
  state.visitedEntries += 1;
  const absolute = path.join(current.directory, entry.name);
  if (entry.isDirectory()) {
    const depth = current.depth + 1;
    if (depth > limits.maxDepth) state.depthExceeded = true;
    else state.pending.push({ directory: absolute, depth });
    return;
  }
  if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'cutover-v1.json') return;
  if (state.files.length >= limits.maxFiles) {
    state.fileLimitExceeded = true;
    return;
  }
  state.files.push(absolute);
}

function scanDirectory(current, state, limits, openDirectory) {
  let handle;
  try {
    handle = openDirectory(current.directory);
    let entry;
    while ((entry = handle.readSync()) !== null) {
      if (state.visitedEntries >= limits.maxEntries) {
        state.entryLimitExceeded = true;
        break;
      }
      processEntry(current, entry, state, limits);
      if (state.fileLimitExceeded) break;
    }
  } catch {
    state.traversalFailed = true;
  } finally {
    if (handle) {
      try {
        handle.closeSync();
      } catch {
        state.traversalFailed = true;
      }
    }
  }
}

function boundedJsonFiles(directory, options) {
  const limits = {
    maxFiles: nonNegativeInteger(options.maxFiles, 'maxFiles'),
    maxDepth: nonNegativeInteger(options.maxDepth, 'maxDepth'),
    maxEntries: positiveInteger(options.maxEntries, 'maxEntries'),
  };
  const state = {
    files: [],
    pending: [{ directory, depth: 0 }],
    visitedEntries: 0,
    fileLimitExceeded: false,
    depthExceeded: false,
    entryLimitExceeded: false,
    traversalFailed: false,
  };
  while (state.pending.length > 0 && !state.fileLimitExceeded && !state.entryLimitExceeded) {
    scanDirectory(state.pending.pop(), state, limits, options.openDirectory);
  }
  state.files.sort();
  return state;
}

function parseBoundedFile(file, root, state, options, reasons, parse) {
  const sourcePath = path.relative(root, file);
  let text;
  try {
    const size = options.statFile(file).size;
    if (size > options.maxBytes) return reportIssue('unavailable', reasons.oversize, sourcePath);
    if (state.totalBytes + size > options.maxTotalBytes) {
      state.totalLimitExceeded = true;
      return reportIssue('unavailable', reasons.totalBytes);
    }
    state.totalBytes += size;
    text = options.readFile(file, 'utf8');
  } catch {
    return reportIssue('unavailable', reasons.unreadable, sourcePath);
  }
  if (Buffer.byteLength(text) > options.maxBytes) {
    return reportIssue('unavailable', reasons.oversize, sourcePath);
  }
  try {
    return parse(JSON.parse(text), sourcePath);
  } catch {
    return reportIssue('invalid', reasons.malformed, sourcePath);
  }
}

function appendTraversalIssues(output, scan, reasons) {
  if (scan.fileLimitExceeded) output.push(reportIssue('unavailable', reasons.fileCount));
  if (scan.depthExceeded) output.push(reportIssue('unavailable', reasons.depth));
  if (scan.entryLimitExceeded) output.push(reportIssue('unavailable', reasons.entryCount));
  if (scan.traversalFailed) output.push(reportIssue('unavailable', reasons.traversal));
}

function readBoundedJson(directory, root, options, reasons, parse) {
  if (!existsSync(directory)) return [];
  const scan = boundedJsonFiles(directory, options);
  const output = [];
  const state = { totalBytes: 0, totalLimitExceeded: false };
  for (const file of scan.files) {
    output.push(parseBoundedFile(file, root, state, options, reasons, parse));
    if (state.totalLimitExceeded) break;
  }
  appendTraversalIssues(output, scan, reasons);
  return output;
}

function readOptions(options = {}) {
  return {
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    readFile: options.readFile ?? readFileSync,
    statFile: options.statFile ?? statSync,
    openDirectory: options.openDirectory ?? opendirSync,
  };
}

const RECEIPT_REASONS = Object.freeze({
  oversize: 'oversize-receipt',
  totalBytes: 'receipt-total-byte-budget-exceeded',
  unreadable: 'unreadable-receipt',
  malformed: 'malformed-json',
  fileCount: 'receipt-count-exceeded',
  depth: 'receipt-depth-exceeded',
  entryCount: 'receipt-entry-count-exceeded',
  traversal: 'receipt-traversal-failed',
});

const LOCAL_REASONS = Object.freeze({
  oversize: 'oversize-local-state',
  totalBytes: 'local-state-total-byte-budget-exceeded',
  unreadable: 'unreadable-local-state',
  malformed: 'malformed-local-state',
  fileCount: 'local-state-count-exceeded',
  depth: 'local-state-depth-exceeded',
  entryCount: 'local-state-entry-count-exceeded',
  traversal: 'local-state-traversal-failed',
});

export function readWorkRunReceipts(root, options = {}) {
  const directory = path.join(root, '.agents/evals/work-runs');
  return readBoundedJson(
    directory,
    root,
    readOptions(options),
    RECEIPT_REASONS,
    (value, sourcePath) => {
      const verdict = validateWorkRunReceipt(value, { receiptPath: sourcePath });
      return verdict.ok
        ? normalizeWorkRunReceipt(verdict.receipt)
        : reportIssue('invalid', verdict.reason ?? 'malformed-receipt', sourcePath);
    },
  );
}

export function readLocalWorkRunTerminals(root, options = {}) {
  const directory = path.join(root, WORK_RUN_LOCAL_DIR);
  return readBoundedJson(directory, root, readOptions(options), LOCAL_REASONS, (value) =>
    projectLocalTerminalWorkRun(value),
  ).filter(Boolean);
}
