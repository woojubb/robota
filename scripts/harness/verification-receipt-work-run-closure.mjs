import { exactWorkRunReceiptTrailers } from './work-run-commit-trailers.mjs';
import { runVerificationCommand } from './verification-receipt-command.mjs';
import { validateWorkRunReceipt } from './work-run-validation.mjs';

const WORK_RUN_RECEIPT_PATH =
  /^\.agents\/evals\/work-runs\/([A-Za-z0-9._-]+)\/g(\d+)-r(\d+)\.json$/u;

export function isWorkRunReceiptClosure(changes) {
  return (
    Array.isArray(changes) &&
    changes.length === 1 &&
    changes[0].startsWith('A\t') &&
    WORK_RUN_RECEIPT_PATH.test(changes[0].slice(2))
  );
}

function exactWorkRunTrailers(message) {
  try {
    const { runId, receiptId } = exactWorkRunReceiptTrailers(message);
    return { runId, receiptName: receiptId };
  } catch {
    return null;
  }
}

function readClosureReceipt(root, currentHead, receiptPath) {
  try {
    return JSON.parse(
      runVerificationCommand('git', ['show', `${currentHead}:${receiptPath}`], root),
    );
  } catch {
    return null;
  }
}

function receiptMatchesClosure(receipt, coordinates, receiptPath, parentHead) {
  const validation = validateWorkRunReceipt(receipt, { receiptPath });
  return (
    validation.ok &&
    receipt.runId === coordinates[1] &&
    receipt.generation === Number(coordinates[2]) &&
    receipt.revision === Number(coordinates[3]) &&
    receipt.identity &&
    typeof receipt.identity === 'object' &&
    !Array.isArray(receipt.identity) &&
    receipt.identity.headCommit === parentHead
  );
}

function validatedWorkRunClosureParent(root, currentHead, changes, parentHead) {
  if (!isWorkRunReceiptClosure(changes)) return null;
  const receiptPath = changes[0].slice(2);
  const coordinates = WORK_RUN_RECEIPT_PATH.exec(receiptPath);
  if (!coordinates) return null;
  const message = runVerificationCommand('git', ['show', '-s', '--format=%B', currentHead], root);
  const trailers = exactWorkRunTrailers(message);
  const expectedReceiptName = `g${coordinates[2]}-r${coordinates[3]}`;
  if (
    !trailers ||
    trailers.runId !== coordinates[1] ||
    trailers.receiptName !== expectedReceiptName
  ) {
    return null;
  }
  const receipt = readClosureReceipt(root, currentHead, receiptPath);
  return receipt && receiptMatchesClosure(receipt, coordinates, receiptPath, parentHead)
    ? parentHead
    : null;
}

function workRunClosureChanges(root, currentHead, parentHead) {
  return runVerificationCommand(
    'git',
    ['diff-tree', '--no-commit-id', '--name-status', '--no-renames', '-r', parentHead, currentHead],
    root,
  )
    .split('\n')
    .filter(Boolean);
}

export function verificationHeadCandidates(root, currentHead) {
  const ancestry = runVerificationCommand(
    'git',
    ['rev-list', '--parents', '-n', '1', currentHead],
    root,
  ).split(' ');
  if (ancestry.length !== 2) return [currentHead];
  const changes = workRunClosureChanges(root, currentHead, ancestry[1]);
  const closureParent = validatedWorkRunClosureParent(root, currentHead, changes, ancestry[1]);
  return closureParent ? [currentHead, closureParent] : [currentHead];
}
