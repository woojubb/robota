import path from 'node:path';

import {
  fetchVerifiedGitHubAuthorizationComment,
  fetchVerifiedGitHubAuthorizationComments,
} from './post-findings-github-comment-verification.mjs';
import { isPostFindingsMaintainer } from './post-findings-approver-policy.mjs';
import { createWorkRunVerificationRuntime } from './work-run-verification-runtime.mjs';

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
    (action === 'rebase' && ground === 'rebase') ||
    (action === 'push' && ['finding', 'red-check'].includes(ground));
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
  runtime = createWorkRunVerificationRuntime(),
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
  runtime = createWorkRunVerificationRuntime(),
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

function option(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

export async function main(argv = process.argv.slice(2)) {
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
  process.stdout.write(results.filter((result) => result.ok).length === 1 ? '1\n' : '0\n');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    process.stderr.write(`post-findings-authorization: ${error.message}\n`);
    process.exitCode = 1;
  });
}
