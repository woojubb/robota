import { createHash } from 'node:crypto';

import { exactWorkRunReceiptTrailers } from './work-run-commit-trailers.mjs';
import { validateWorkRunReceipt } from './work-run-receipt-validation.mjs';
import { OID_PATTERN } from './work-run-validation-foundation.mjs';

const MAX_RECEIPT_BYTES = 1024 * 1024;

function decodeBase64File(content) {
  if (
    content?.type !== 'file' ||
    content.encoding !== 'base64' ||
    typeof content.content !== 'string' ||
    content.content.length > MAX_RECEIPT_BYTES * 2
  ) {
    throw new Error('GitHub opening receipt blob evidence is invalid');
  }
  const normalized = content.content.replace(/\s/gu, '');
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length > MAX_RECEIPT_BYTES || bytes.toString('base64') !== normalized) {
    throw new Error('GitHub opening receipt blob evidence is invalid');
  }
  return bytes;
}

export function validateRemoteOpeningClosure({ commit, content, headOid, runId }) {
  const receiptPath = `.agents/evals/work-runs/${runId}/g0-r0.json`;
  const parent = commit?.parents?.[0]?.sha;
  const file = commit?.files?.[0];
  const exactCommit =
    commit?.sha === headOid &&
    Array.isArray(commit.parents) &&
    commit.parents.length === 1 &&
    OID_PATTERN.test(parent ?? '') &&
    Array.isArray(commit.files) &&
    commit.files.length === 1 &&
    file?.filename === receiptPath &&
    file.status === 'added' &&
    OID_PATTERN.test(file.sha ?? '');
  const exactContent =
    content?.path === receiptPath &&
    content?.sha === file?.sha &&
    OID_PATTERN.test(content?.sha ?? '');
  if (!exactCommit || !exactContent) {
    throw new Error('GitHub opening head is not an exact receipt-only closure');
  }
  const trailers = exactWorkRunReceiptTrailers(commit.commit?.message);
  if (trailers.runId !== runId || trailers.receiptId !== 'g0-r0') {
    throw new Error('GitHub opening closure commit trailers do not match the receipt');
  }
  const bytes = decodeBase64File(content);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('GitHub opening receipt blob is not valid JSON');
  }
  const verdict = validateWorkRunReceipt(value, { receiptPath });
  const allowedDisposition =
    verdict.ok &&
    (['included', 'excluded'].includes(verdict.receipt.disposition) ||
      (verdict.receipt.disposition === 'invalid' && verdict.receipt.reason === 'state-lost'));
  const validReceipt =
    allowedDisposition &&
    verdict.receipt.runId === runId &&
    verdict.receipt.generation === 0 &&
    verdict.receipt.revision === 0 &&
    verdict.receipt.identity?.headCommit === parent;
  if (!validReceipt) throw new Error('GitHub opening receipt blob is invalid');
  return {
    receiptPath,
    receiptDigest: createHash('sha256').update(bytes).digest('hex'),
  };
}
