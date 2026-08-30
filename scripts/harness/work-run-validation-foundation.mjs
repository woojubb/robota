import { isPostFindingsMaintainer } from './post-findings-approver-policy.mjs';

export const RECEIPT_PATH_PATTERN =
  /^\.agents\/evals\/work-runs\/([A-Za-z0-9._-]+)\/g(\d+)-r(\d+)\.json$/;
export const OID_PATTERN = /^[0-9a-f]{40}$/;
export const AUTHORIZATION_KEYS = Object.freeze([
  'approvedBy',
  'action',
  'commentAuthor',
  'commentAuthorAssociation',
  'commentId',
  'commentUrl',
  'evidence',
  'ground',
  'head',
  'prNumber',
  'scope',
  'verdict',
]);
export const POST_PR_GROUNDS = new Set(['finding', 'red-check', 'rebase']);
export const MAX_RANGE_RECEIPTS = 100;
export const MAX_RANGE_COMMITS = 1_000;
export const IDENTITY_FIELDS = [
  'repository',
  'branch',
  'baseCommit',
  'headCommit',
  'headTree',
  'commitOids',
  'trailerDigest',
  'ownerFingerprint',
];

export function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...keys].sort())
  );
}

function validHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function identitiesMatch(actual, expected) {
  if (!actual || !expected) return false;
  return IDENTITY_FIELDS.every((field) => same(actual[field], expected[field]));
}

export function validateWorkRunIdentity(identity) {
  return (
    exactKeys(identity, IDENTITY_FIELDS) &&
    typeof identity.repository === 'string' &&
    identity.repository.length > 0 &&
    !identity.repository.includes('\0') &&
    typeof identity.branch === 'string' &&
    identity.branch.length > 0 &&
    !identity.branch.includes('\0') &&
    OID_PATTERN.test(identity.baseCommit) &&
    OID_PATTERN.test(identity.headCommit) &&
    OID_PATTERN.test(identity.headTree) &&
    Array.isArray(identity.commitOids) &&
    identity.commitOids.every((oid) => OID_PATTERN.test(oid)) &&
    /^[0-9a-f]{64}$/.test(identity.trailerDigest) &&
    /^[0-9a-f]{64}$/.test(identity.ownerFingerprint)
  );
}

export function validatePostPrAuthorizationProjection(authorization) {
  if (!exactKeys(authorization, AUTHORIZATION_KEYS)) return false;
  return (
    Number.isInteger(authorization.prNumber) &&
    authorization.prNumber > 0 &&
    OID_PATTERN.test(authorization.head) &&
    Number.isInteger(authorization.verdict) &&
    authorization.verdict >= 0 &&
    ['push', 'rebase'].includes(authorization.action) &&
    POST_PR_GROUNDS.has(authorization.ground) &&
    (authorization.action === 'rebase') === (authorization.ground === 'rebase') &&
    validHttpUrl(authorization.evidence) &&
    typeof authorization.scope === 'string' &&
    authorization.scope.length > 0 &&
    /^@[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(authorization.approvedBy) &&
    Number.isSafeInteger(authorization.commentId) &&
    authorization.commentId > 0 &&
    validHttpUrl(authorization.commentUrl) &&
    typeof authorization.commentAuthor === 'string' &&
    authorization.commentAuthor.length > 0 &&
    isPostFindingsMaintainer({
      login: authorization.commentAuthor,
      association: authorization.commentAuthorAssociation,
    }) &&
    authorization.approvedBy.toLowerCase() === `@${authorization.commentAuthor}`.toLowerCase()
  );
}

export function authorizationsMatch(actual, expected) {
  return (
    exactKeys(actual, AUTHORIZATION_KEYS) &&
    exactKeys(expected, AUTHORIZATION_KEYS) &&
    AUTHORIZATION_KEYS.every((field) => same(actual[field], expected[field]))
  );
}

export function receiptPathCoordinates(receiptPath) {
  const match = RECEIPT_PATH_PATTERN.exec(receiptPath);
  if (!match) return null;
  return { runId: match[1], generation: Number(match[2]), revision: Number(match[3]) };
}
