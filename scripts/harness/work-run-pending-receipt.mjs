import { spawnSync } from 'node:child_process';

import { receiptPathCoordinates } from './work-run-validation-foundation.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 1024 * 1024;

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

function validTerminalReceipt(receipt, coordinates) {
  const coordinatesMatch =
    receipt?.runId === coordinates.runId &&
    receipt?.generation === coordinates.generation &&
    receipt?.revision === coordinates.revision;
  const terminalDisposition =
    receipt?.disposition === 'excluded' ||
    (receipt?.disposition === 'invalid' && receipt?.reason === 'state-lost');
  return coordinatesMatch && terminalDisposition;
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
  const receiptChanges = changes.filter(({ file }) => receiptPathCoordinates(file));
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
  if (!validTerminalReceipt(receipt, coordinates)) {
    throw new Error('pending work-run receipt does not match its exact path coordinates');
  }
  return {
    runId: coordinates.runId,
    receipt: `g${coordinates.generation}-r${coordinates.revision}`,
  };
}
