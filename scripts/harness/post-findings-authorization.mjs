import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  fetchVerifiedGitHubAuthorizationComment,
  fetchVerifiedGitHubAuthorizationComments,
} from './post-findings-github-comment-verification.mjs';
import { isPostFindingsMaintainer } from './post-findings-approver-policy.mjs';
import {
  createVerificationRuntime,
  takeVerificationQuery,
} from './verification-budget-runtime.mjs';

// Closeout CLI:
//   --select-merge-decision --pr N --head SHA --base BRANCH  (comments JSON on stdin)
//   --audit-closeout --repo OWNER/REPO --pr N --issue N|none --merge-comment N --completion-comment N

const REQUIRED = Object.freeze([
  'PR',
  'HEAD',
  'VERDICT',
  'ACTION',
  'GROUND',
  'EVIDENCE',
  'SCOPE',
  'APPROVED',
  'APPROVED-BY',
]);
const ALLOWED_FIELDS = new Set(REQUIRED);
function validHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function parsePostFindingsAuthorization(body) {
  const lines = String(body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.filter((line) => line === 'POST_FINDINGS_ACTION_REQUEST').length !== 1) return null;
  if (lines[0] !== 'POST_FINDINGS_ACTION_REQUEST') return null;
  const fields = new Map();
  for (const line of lines.slice(1)) {
    const match = /^([A-Z][A-Z-]*):\s*(.+?)\s*$/.exec(line);
    if (!match || !ALLOWED_FIELDS.has(match[1]) || fields.has(match[1])) return null;
    fields.set(match[1], match[2]);
  }
  if (fields.size !== REQUIRED.length || REQUIRED.some((field) => !fields.has(field))) return null;
  const prNumber = Number(fields.get('PR'));
  const verdict = Number(fields.get('VERDICT'));
  const action = fields.get('ACTION').toLowerCase();
  const ground = fields.get('GROUND').toLowerCase();
  if (
    !Number.isInteger(prNumber) ||
    prNumber < 1 ||
    !Number.isInteger(verdict) ||
    verdict < 0 ||
    !/^[0-9a-f]{40}$/i.test(fields.get('HEAD')) ||
    !validHttpUrl(fields.get('EVIDENCE'))
  )
    return null;
  const actionMatchesGround =
    action === 'push' && ['finding', 'red-check', 'conflict'].includes(ground);
  if (!actionMatchesGround) return null;
  if (
    fields.get('APPROVED').toLowerCase() !== 'yes' ||
    !/^@[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(fields.get('APPROVED-BY'))
  )
    return null;
  return {
    prNumber,
    head: fields.get('HEAD'),
    verdict,
    action,
    ground,
    evidence: fields.get('EVIDENCE'),
    scope: fields.get('SCOPE'),
    approvedBy: fields.get('APPROVED-BY'),
  };
}

export function parsePostFindingsAuthorizationEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  const { id, url, author, body } = envelope;
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !validHttpUrl(url) ||
    !author ||
    typeof author !== 'object' ||
    !isPostFindingsMaintainer(author) ||
    typeof body !== 'string'
  )
    return null;
  const projection = parsePostFindingsAuthorization(body);
  if (!projection || projection.approvedBy.toLowerCase() !== `@${author.login}`.toLowerCase())
    return null;
  const urlIdentity = /\/(?:issues|pull)\/(\d+)#issuecomment-(\d+)$/.exec(
    new URL(url).pathname + new URL(url).hash,
  );
  if (
    !urlIdentity ||
    Number(urlIdentity[1]) !== projection.prNumber ||
    Number(urlIdentity[2]) !== id
  ) {
    return null;
  }
  return {
    ...projection,
    commentId: id,
    commentUrl: url,
    commentAuthor: author.login,
    commentAuthorAssociation: author.association,
  };
}

function trustedFetchedAuthorization(comment) {
  const authorization = parsePostFindingsAuthorizationEnvelope({
    id: comment.id,
    url: comment.html_url,
    author: {
      login: comment.user?.login,
      association: comment.author_association,
    },
    body: comment.body,
  });
  if (!authorization) {
    throw new Error('GitHub comment response is not a trusted post-findings authorization');
  }
  return authorization;
}

export function fetchPostFindingsAuthorization({
  repository,
  commentId,
  authorizedAt = null,
  runGh,
  runtime = createVerificationRuntime(),
}) {
  const comment = fetchVerifiedGitHubAuthorizationComment({
    repository,
    commentId,
    authorizedAt,
    runGh,
    runtime,
  });
  return trustedFetchedAuthorization(comment);
}

export function fetchPostFindingsAuthorizations({
  repository,
  prNumber,
  requests,
  runGh,
  runtime = createVerificationRuntime(),
}) {
  const comments = fetchVerifiedGitHubAuthorizationComments({
    repository,
    prNumber,
    requests,
    runGh,
    runtime,
  });
  return requests.map(({ commentId }) => trustedFetchedAuthorization(comments.get(commentId)));
}

export function selectPostFindingsAuthorization({
  comments,
  prNumber,
  head,
  verdict,
  action,
  ground = null,
}) {
  const matches = comments
    .map((comment) => parsePostFindingsAuthorizationEnvelope(comment))
    .filter(
      (projection) =>
        projection &&
        projection.prNumber === prNumber &&
        projection.head === head &&
        projection.verdict === verdict &&
        projection.action === action &&
        (ground === null || projection.ground === ground),
    );
  if (matches.length !== 1)
    return {
      ok: false,
      reason: matches.length === 0 ? 'missing-authorization' : 'ambiguous-authorization',
    };
  return {
    ok: true,
    ...matches[0],
  };
}

function parseStrictRecord(body, marker, required) {
  const lines = String(body ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== marker || lines.filter((line) => line === marker).length !== 1) return null;
  const allowed = new Set(required);
  const fields = new Map();
  for (const line of lines.slice(1)) {
    const match = /^([A-Z][A-Z-]*):\s*(.+?)\s*$/.exec(line);
    if (!match || !allowed.has(match[1]) || fields.has(match[1])) return null;
    fields.set(match[1], match[2]);
  }
  return fields.size === required.length && required.every((field) => fields.has(field))
    ? fields
    : null;
}

const MERGE_DECISION_FIELDS = Object.freeze([
  'PR',
  'HEAD',
  'BASE',
  'BASE-OID',
  'VERDICT',
  'CI-OBSERVER',
  'CI-RESULT',
  'REMOTE-FEEDBACK',
  'SCOPE',
  'AUTHORITY',
  'AUTHORITY-EVIDENCE',
  'APPROVED',
  'APPROVED-BY',
]);

export function parseMergeDecisionReceipt(body) {
  const fields = parseStrictRecord(body, 'PR_MERGE_DECISION', MERGE_DECISION_FIELDS);
  if (!fields) return null;
  const prNumber = Number(fields.get('PR'));
  const verdict = Number(fields.get('VERDICT'));
  const authority = fields.get('AUTHORITY').toLowerCase();
  const approvedBy = fields.get('APPROVED-BY');
  const validApprover =
    (authority === 'direct' && /^@[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(approvedBy)) ||
    (authority === 'owner-delegated' &&
      /^agent:[A-Za-z0-9._-]+ \(owner-delegated\)$/.test(approvedBy));
  if (
    !Number.isSafeInteger(prNumber) ||
    prNumber < 1 ||
    verdict !== 0 ||
    !/^[0-9a-f]{40}$/i.test(fields.get('HEAD')) ||
    !/^[0-9a-f]{40}$/i.test(fields.get('BASE-OID')) ||
    !/^(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(fields.get('BASE')) ||
    fields.get('CI-OBSERVER') !== 'ci-gate-watch' ||
    fields.get('CI-RESULT') !== 'GREEN' ||
    !['empty', 'resolved'].includes(fields.get('REMOTE-FEEDBACK')) ||
    !validHttpUrl(fields.get('AUTHORITY-EVIDENCE')) ||
    fields.get('APPROVED').toLowerCase() !== 'yes' ||
    !validApprover
  ) {
    return null;
  }
  return {
    prNumber,
    head: fields.get('HEAD').toLowerCase(),
    base: fields.get('BASE'),
    baseOid: fields.get('BASE-OID').toLowerCase(),
    verdict,
    ciObserver: fields.get('CI-OBSERVER'),
    ciResult: fields.get('CI-RESULT'),
    remoteFeedback: fields.get('REMOTE-FEEDBACK'),
    scope: fields.get('SCOPE'),
    authority,
    authorityEvidence: fields.get('AUTHORITY-EVIDENCE'),
    approvedBy,
  };
}

const DELIVERY_COMPLETION_FIELDS = Object.freeze([
  'OUTCOME',
  'ISSUE',
  'PR',
  'HEAD',
  'MERGE',
  'BASE',
  'LANDING',
  'BRANCH',
  'BRANCH-DETAIL',
  'BASE-RESET',
  'CRITERIA',
  'ACTION',
]);

export function parseDeliveryCompletionReceipt(body) {
  const fields = parseStrictRecord(body, 'DELIVERY_COMPLETION_RECORD', DELIVERY_COMPLETION_FIELDS);
  if (!fields) return null;
  const outcome = fields.get('OUTCOME');
  const issueNumber = fields.get('ISSUE') === 'none' ? null : Number(fields.get('ISSUE'));
  const prNumber = Number(fields.get('PR'));
  const criteria = fields.get('CRITERIA');
  const action = fields.get('ACTION');
  const validOutcome =
    (outcome === 'closed' &&
      issueNumber !== null &&
      criteria === 'delivered' &&
      action === 'close') ||
    (outcome === 'open-partial' &&
      issueNumber !== null &&
      criteria.startsWith('remaining:') &&
      criteria.length > 'remaining:'.length &&
      action === 'leave-open') ||
    (outcome === 'no-issue' && issueNumber === null && criteria === 'none' && action === 'none');
  if (
    !validOutcome ||
    (issueNumber !== null && (!Number.isSafeInteger(issueNumber) || issueNumber < 1)) ||
    !Number.isSafeInteger(prNumber) ||
    prNumber < 1 ||
    !/^[0-9a-f]{40}$/i.test(fields.get('HEAD')) ||
    !/^[0-9a-f]{40}$/i.test(fields.get('MERGE')) ||
    !/^(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(fields.get('BASE')) ||
    fields.get('LANDING') !== 'verified' ||
    !['deleted', 'retained'].includes(fields.get('BRANCH')) ||
    fields.get('BRANCH-DETAIL').length === 0 ||
    !/^(?:skipped|[A-Za-z0-9._/-]+@[0-9a-f]{40})$/i.test(fields.get('BASE-RESET'))
  ) {
    return null;
  }
  return {
    outcome,
    issueNumber,
    prNumber,
    head: fields.get('HEAD').toLowerCase(),
    mergeCommit: fields.get('MERGE').toLowerCase(),
    base: fields.get('BASE'),
    landing: fields.get('LANDING'),
    branch: fields.get('BRANCH'),
    branchDetail: fields.get('BRANCH-DETAIL'),
    baseReset: fields.get('BASE-RESET'),
    criteria,
    action,
  };
}

function trustedCloseoutEnvelope(envelope, parse) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  if (
    !Number.isSafeInteger(envelope.id) ||
    envelope.id < 1 ||
    !validHttpUrl(envelope.url) ||
    !isPostFindingsMaintainer(envelope.author) ||
    typeof envelope.body !== 'string' ||
    !Number.isFinite(Date.parse(envelope.createdAt)) ||
    envelope.updatedAt !== envelope.createdAt ||
    envelope.lastEditedAt !== null
  ) {
    return null;
  }
  const receipt = parse(envelope.body);
  if (!receipt) return null;
  if (
    receipt.authority === 'direct' &&
    receipt.approvedBy.toLowerCase() !== `@${envelope.author.login}`.toLowerCase()
  ) {
    return null;
  }
  const url = new URL(envelope.url);
  const identity = /^\/(?:[^/]+\/){2}(?:issues|pull)\/(\d+)$/.exec(url.pathname);
  const commentId = /^#issuecomment-(\d+)$/.exec(url.hash);
  if (!identity || !commentId || Number(commentId[1]) !== envelope.id) return null;
  return {
    ...receipt,
    commentId: envelope.id,
    commentUrl: envelope.url,
    commentNumber: Number(identity[1]),
    commentAuthor: envelope.author.login,
    createdAt: envelope.createdAt,
  };
}

function uniqueReceipt(comments, parse, missing, ambiguous, matchesSubject = () => true) {
  const matches = comments
    .map((comment) => trustedCloseoutEnvelope(comment, parse))
    .filter(Boolean)
    .filter(matchesSubject);
  if (matches.length === 0) return { ok: false, reason: missing };
  if (matches.length !== 1) return { ok: false, reason: ambiguous };
  return { ok: true, receipt: matches[0] };
}

export function auditMergeDecisionReceipts({ pr, comments }) {
  if (!pr || !Array.isArray(comments)) return { ok: false, reason: 'invalid-merge-projection' };
  const selected = uniqueReceipt(
    comments,
    parseMergeDecisionReceipt,
    'missing-merge-decision',
    'ambiguous-merge-decision',
  );
  if (!selected.ok) return selected;
  const mergeDecision = selected.receipt;
  if (
    mergeDecision.commentNumber !== pr.number ||
    mergeDecision.prNumber !== pr.number ||
    mergeDecision.head !== String(pr.headRefOid ?? '').toLowerCase() ||
    mergeDecision.base !== pr.baseRefName
  ) {
    return { ok: false, reason: 'merge-decision-state-mismatch' };
  }
  return { ok: true, mergeDecision };
}

export function auditCloseoutReceipts({
  repository,
  pr,
  issue,
  mergeComments,
  completionComments,
  historicalBaseAncestry,
}) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? '') || !pr || !Array.isArray(mergeComments)) {
    return { ok: false, reason: 'invalid-closeout-projection' };
  }
  const selectedMerge = uniqueReceipt(
    mergeComments,
    parseMergeDecisionReceipt,
    'missing-merge-decision',
    'ambiguous-merge-decision',
  );
  if (!selectedMerge.ok) return selectedMerge;
  const mergeDecision = selectedMerge.receipt;
  const selectedCompletion = uniqueReceipt(
    completionComments ?? [],
    parseDeliveryCompletionReceipt,
    'missing-completion',
    'ambiguous-completion',
    (receipt) => receipt.prNumber === pr.number,
  );
  if (!selectedCompletion.ok) return selectedCompletion;
  const completion = selectedCompletion.receipt;
  const mergedAt = Date.parse(pr.mergedAt);
  const expectedCommentNumber = completion.issueNumber ?? pr.number;
  const expectedIssueState = completion.outcome === 'closed' ? 'CLOSED' : 'OPEN';
  if (
    !Number.isFinite(mergedAt) ||
    mergeDecision.commentNumber !== pr.number ||
    mergeDecision.prNumber !== pr.number ||
    mergeDecision.head !== String(pr.headRefOid ?? '').toLowerCase() ||
    mergeDecision.base !== pr.baseRefName ||
    historicalBaseAncestry?.mergeCommit !== String(pr.mergeCommit?.oid ?? '').toLowerCase() ||
    historicalBaseAncestry?.historicalBase !== mergeDecision.baseOid ||
    !/^[0-9a-f]{40}$/u.test(historicalBaseAncestry?.firstParent ?? '') ||
    !['ahead', 'identical'].includes(historicalBaseAncestry?.status) ||
    Date.parse(mergeDecision.createdAt) > mergedAt
  ) {
    return { ok: false, reason: 'merge-decision-state-mismatch' };
  }
  if (
    pr.state !== 'MERGED' ||
    Date.parse(completion.createdAt) < mergedAt ||
    Date.parse(completion.createdAt) < Date.parse(mergeDecision.createdAt) ||
    completion.commentNumber !== expectedCommentNumber ||
    completion.prNumber !== pr.number ||
    completion.head !== String(pr.headRefOid ?? '').toLowerCase() ||
    completion.mergeCommit !== String(pr.mergeCommit?.oid ?? '').toLowerCase() ||
    completion.base !== pr.baseRefName ||
    (completion.issueNumber === null
      ? issue !== null && issue !== undefined
      : !issue || issue.number !== completion.issueNumber || issue.state !== expectedIssueState)
  ) {
    return { ok: false, reason: 'completion-state-mismatch' };
  }
  return { ok: true, mergeDecision, completion };
}

function defaultRunGh(args, options) {
  return spawnSync('gh', args, { encoding: 'utf8', ...options });
}

function boundedGhJson(args, runGh, runtime) {
  const timeout = takeVerificationQuery(runtime);
  const result = runGh(args, { timeout, maxBuffer: 256 * 1024 });
  if (result?.error || result?.status !== 0) {
    throw new Error(
      `GitHub closeout readback failed: ${result?.error?.message ?? result?.stderr ?? 'unknown error'}`,
    );
  }
  try {
    return JSON.parse(String(result.stdout ?? ''));
  } catch {
    throw new Error('GitHub closeout readback returned invalid JSON');
  }
}

function closeoutEnvelopeFromView(comment) {
  return {
    id: Number(/#issuecomment-(\d+)$/.exec(comment?.url ?? '')?.[1]),
    url: comment?.url,
    author: {
      login: comment?.author?.login,
      association: comment?.authorAssociation,
    },
    body: comment?.body,
    createdAt: comment?.createdAt,
    updatedAt: comment?.createdAt,
    lastEditedAt: comment?.includesCreatedEdit ? comment.createdAt : null,
  };
}

function closeoutEnvelopeFromApi(comment) {
  return {
    id: comment?.id,
    url: comment?.html_url,
    author: {
      login: comment?.user?.login,
      association: comment?.author_association,
    },
    body: comment?.body,
    createdAt: comment?.created_at,
    updatedAt: comment?.updated_at,
    lastEditedAt: comment?.created_at === comment?.updated_at ? null : comment?.updated_at,
  };
}

function fetchCloseoutCommentEnvelopes(repository, number, runGh, runtime) {
  const pages = boundedGhJson(
    ['api', `repos/${repository}/issues/${number}/comments?per_page=100`, '--paginate', '--slurp'],
    runGh,
    runtime,
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error('GitHub closeout comment projection is invalid');
  }
  return pages.flat().map(closeoutEnvelopeFromApi);
}

function fetchHistoricalBaseAncestry({ repository, pr, mergeDecision, runGh, runtime }) {
  const mergeCommit = String(pr?.mergeCommit?.oid ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(mergeCommit) || !mergeDecision) return null;
  const commit = boundedGhJson(
    ['api', `repos/${repository}/commits/${mergeCommit}`],
    runGh,
    runtime,
  );
  const firstParent = String(commit?.parents?.[0]?.sha ?? '').toLowerCase();
  if (
    String(commit?.sha ?? '').toLowerCase() !== mergeCommit ||
    !/^[0-9a-f]{40}$/u.test(firstParent)
  ) {
    return null;
  }
  const comparison = boundedGhJson(
    ['api', `repos/${repository}/compare/${mergeDecision.baseOid}...${firstParent}`],
    runGh,
    runtime,
  );
  return {
    mergeCommit,
    firstParent,
    historicalBase: mergeDecision.baseOid,
    status: comparison?.status,
  };
}

export function fetchCloseoutAudit({
  repository,
  prNumber,
  issueNumber = null,
  mergeCommentId,
  completionCommentId,
  runGh = defaultRunGh,
  runtime = createVerificationRuntime(),
}) {
  if (
    !/^[^/\s]+\/[^/\s]+$/.test(repository ?? '') ||
    !Number.isSafeInteger(prNumber) ||
    prNumber < 1 ||
    (issueNumber !== null && (!Number.isSafeInteger(issueNumber) || issueNumber < 1))
  ) {
    throw new Error(
      'GitHub closeout readback requires a repository, PR, and optional positive issue',
    );
  }
  const mergeComment = fetchVerifiedGitHubAuthorizationComment({
    repository,
    commentId: mergeCommentId,
    authorizedAt: null,
    runGh,
    runtime,
  });
  const completionComment = fetchVerifiedGitHubAuthorizationComment({
    repository,
    commentId: completionCommentId,
    authorizedAt: null,
    runGh,
    runtime,
  });
  const mergeComments = fetchCloseoutCommentEnvelopes(repository, prNumber, runGh, runtime);
  const pr = boundedGhJson(
    [
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repository,
      '--json',
      'number,state,headRefOid,baseRefName,baseRefOid,mergeCommit,mergedAt',
    ],
    runGh,
    runtime,
  );
  const completionComments =
    issueNumber === null
      ? mergeComments
      : fetchCloseoutCommentEnvelopes(repository, issueNumber, runGh, runtime);
  const issue =
    issueNumber === null
      ? null
      : boundedGhJson(
          ['issue', 'view', String(issueNumber), '--repo', repository, '--json', 'number,state'],
          runGh,
          runtime,
        );
  const selectedMerge = uniqueReceipt(
    mergeComments,
    parseMergeDecisionReceipt,
    'missing-merge-decision',
    'ambiguous-merge-decision',
  );
  const historicalBaseAncestry = selectedMerge.ok
    ? fetchHistoricalBaseAncestry({
        repository,
        pr,
        mergeDecision: selectedMerge.receipt,
        runGh,
        runtime,
      })
    : null;
  const audit = auditCloseoutReceipts({
    repository,
    pr,
    issue,
    mergeComments,
    completionComments,
    historicalBaseAncestry,
  });
  if (
    audit.ok &&
    (audit.mergeDecision.commentId !== mergeComment.id ||
      audit.completion.commentId !== completionComment.id)
  ) {
    return { ok: false, reason: 'closeout-comment-identity-mismatch' };
  }
  return audit;
}

function option(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--select-merge-decision')) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const comments = JSON.parse(chunks.join(''));
    const envelopes = comments.map(closeoutEnvelopeFromView);
    const result = auditMergeDecisionReceipts({
      pr: {
        number: Number(option(argv, '--pr')),
        headRefOid: option(argv, '--head'),
        baseRefName: option(argv, '--base'),
      },
      comments: envelopes,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (argv.includes('--audit-closeout')) {
    const issue = option(argv, '--issue');
    const result = fetchCloseoutAudit({
      repository: option(argv, '--repo'),
      prNumber: Number(option(argv, '--pr')),
      issueNumber: issue === null || issue === 'none' ? null : Number(issue),
      mergeCommentId: Number(option(argv, '--merge-comment')),
      completionCommentId: Number(option(argv, '--completion-comment')),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const comments = JSON.parse(chunks.join(''));
  const actions = (option(argv, '--actions') ?? 'push').split(',');
  const results = actions.map((action) =>
    selectPostFindingsAuthorization({
      comments,
      prNumber: Number(option(argv, '--pr')),
      head: option(argv, '--head'),
      verdict: Number(option(argv, '--verdict')),
      action,
    }),
  );
  const matches = results.filter((result) => result.ok);
  process.stdout.write(matches.length === 1 ? `${matches[0].ground}\n` : '0\n');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    process.stderr.write(`post-findings-authorization: ${error.message}\n`);
    process.exitCode = 1;
  });
}
