import { spawnSync } from 'node:child_process';

import { takeWorkRunVerificationQuery } from './work-run-verification-runtime.mjs';

const GITHUB_COMMENT_TIMEOUT_MS = 15_000;
const GITHUB_COMMENT_MAX_BYTES = 256 * 1024;
const MAX_COMMENT_PAGES = 10;
const BATCH_COMMENT_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      comments(first: 100, after: $after) {
        nodes { databaseId url body authorAssociation createdAt lastEditedAt author { login } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;
const COMMENT_EDIT_QUERY = `query($nodeId: ID!) {
  node(id: $nodeId) {
    __typename
    ... on IssueComment { databaseId lastEditedAt }
  }
}`;

function defaultRunGh(args, options) {
  return spawnSync('gh', args, { encoding: 'utf8', ...options });
}

function verifiedCommentOutput(result) {
  if (result?.error?.code === 'ETIMEDOUT') {
    throw new Error('GitHub comment verification timed out after 15 seconds');
  }
  if (result?.error?.code === 'ENOBUFS') {
    throw new Error('GitHub comment response exceeded the size limit');
  }
  if (result?.error) {
    throw new Error(`GitHub comment verification failed: ${result.error.message}`);
  }
  if (result?.status !== 0) {
    throw new Error(`GitHub comment verification failed: ${String(result?.stderr ?? '').trim()}`);
  }

  const output = String(result.stdout ?? '');
  if (Buffer.byteLength(output) > GITHUB_COMMENT_MAX_BYTES) {
    throw new Error('GitHub comment response exceeded the size limit');
  }
  return output;
}

function parseFetchedComment(output, commentId) {
  let comment;
  try {
    comment = JSON.parse(output);
  } catch {
    throw new Error('GitHub comment response is not valid JSON');
  }
  if (comment?.id !== commentId) {
    throw new Error('GitHub comment identity does not match the requested comment ID');
  }
  return comment;
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateAuthorizationCommentTime(comment, authorizedAt) {
  if (!validInstant(comment.created_at) || !validInstant(comment.updated_at)) {
    throw new Error('GitHub authorization comment timestamp is invalid');
  }
  if (comment.created_at !== comment.updated_at) {
    throw new Error('GitHub authorization comment was edited after creation');
  }
  if (authorizedAt === null) return;
  if (!validInstant(authorizedAt)) {
    throw new Error('Authorized work boundary timestamp is invalid');
  }
  if (Date.parse(comment.created_at) > Date.parse(authorizedAt)) {
    throw new Error('GitHub authorization comment is later than the authorized work boundary');
  }
}

function parseCommentEditSignal(output, commentId) {
  let response;
  try {
    response = JSON.parse(output);
  } catch {
    throw new Error('GitHub comment edit response is not valid JSON');
  }
  if (
    (Object.hasOwn(response ?? {}, 'errors') &&
      (!Array.isArray(response.errors) || response.errors.length !== 0)) ||
    response?.data?.node?.__typename !== 'IssueComment' ||
    response.data.node.databaseId !== commentId
  ) {
    throw new Error('GitHub comment edit response is invalid');
  }
  if (response.data.node.lastEditedAt !== null) {
    throw new Error('GitHub authorization comment was edited after creation');
  }
}

function verifyCommentWasNeverEdited(comment, commentId, runGh, runtime) {
  if (typeof comment.node_id !== 'string' || comment.node_id.length === 0) {
    throw new Error('GitHub authorization comment lacks an immutable node identity');
  }
  const timeout = takeWorkRunVerificationQuery(runtime);
  const result = runGh(
    ['api', 'graphql', '-f', `query=${COMMENT_EDIT_QUERY}`, '-f', `nodeId=${comment.node_id}`],
    {
      timeout: Math.min(GITHUB_COMMENT_TIMEOUT_MS, timeout),
      maxBuffer: GITHUB_COMMENT_MAX_BYTES,
    },
  );
  parseCommentEditSignal(verifiedCommentOutput(result), commentId);
}

function validateRequest(repository, commentId) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? '')) {
    throw new Error('GitHub comment verification requires an owner/repository name');
  }
  if (!Number.isSafeInteger(commentId) || commentId < 1) {
    throw new Error('GitHub comment verification requires a numeric comment ID');
  }
}

function parseBatchPage(output) {
  let response;
  try {
    response = JSON.parse(output);
  } catch {
    throw new Error('GitHub authorization batch response is not valid JSON');
  }
  if (
    (Object.hasOwn(response ?? {}, 'errors') &&
      (!Array.isArray(response.errors) || response.errors.length !== 0)) ||
    !Array.isArray(response?.data?.repository?.pullRequest?.comments?.nodes)
  ) {
    throw new Error('GitHub authorization batch response is invalid');
  }
  const { nodes, pageInfo } = response.data.repository.pullRequest.comments;
  const validPageInfo =
    typeof pageInfo?.hasNextPage === 'boolean' &&
    (pageInfo.endCursor === null || typeof pageInfo.endCursor === 'string') &&
    (!pageInfo.hasNextPage || (pageInfo.endCursor?.length ?? 0) > 0);
  if (!validPageInfo) throw new Error('GitHub authorization batch pageInfo is invalid');
  return { nodes, pageInfo };
}

function batchComment(node) {
  if (
    !Number.isSafeInteger(node?.databaseId) ||
    node.databaseId < 1 ||
    typeof node.url !== 'string' ||
    typeof node.body !== 'string' ||
    typeof node.author?.login !== 'string' ||
    typeof node.authorAssociation !== 'string' ||
    node.lastEditedAt !== null
  ) {
    throw new Error('GitHub authorization batch comment is invalid or edited');
  }
  return {
    id: node.databaseId,
    html_url: node.url,
    user: { login: node.author.login },
    author_association: node.authorAssociation,
    body: node.body,
    created_at: node.createdAt,
    updated_at: node.createdAt,
  };
}

function batchArgs(repository, prNumber, after) {
  const [owner, name] = repository.split('/');
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${BATCH_COMMENT_QUERY}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `number=${prNumber}`,
  ];
  if (after !== null) args.push('-f', `after=${after}`);
  return args;
}

function validateBatchRequest(repository, prNumber, requests) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? '')) {
    throw new Error('GitHub authorization batch requires an owner/repository name');
  }
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) {
    throw new Error('GitHub authorization batch requires a pull request number');
  }
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 100) {
    throw new Error('GitHub authorization batch requires one to one hundred comments');
  }
  for (const request of requests) validateRequest(repository, request?.commentId);
}

export function fetchVerifiedGitHubAuthorizationComments({
  repository,
  prNumber,
  requests,
  runtime,
  runGh = defaultRunGh,
}) {
  validateBatchRequest(repository, prNumber, requests);
  const wanted = new Set(requests.map(({ commentId }) => commentId));
  const found = new Map();
  let after = null;
  for (let page = 0; page < MAX_COMMENT_PAGES && found.size < wanted.size; page += 1) {
    const timeout = takeWorkRunVerificationQuery(runtime);
    const result = runGh(batchArgs(repository, prNumber, after), {
      timeout: Math.min(GITHUB_COMMENT_TIMEOUT_MS, timeout),
      maxBuffer: GITHUB_COMMENT_MAX_BYTES,
    });
    const parsed = parseBatchPage(verifiedCommentOutput(result));
    for (const node of parsed.nodes) {
      if (!wanted.has(node?.databaseId)) continue;
      if (found.has(node.databaseId)) throw new Error('GitHub authorization comment is ambiguous');
      found.set(node.databaseId, batchComment(node));
    }
    if (!parsed.pageInfo.hasNextPage) break;
    after = parsed.pageInfo.endCursor;
  }
  if (found.size !== wanted.size) throw new Error('GitHub authorization comment is missing');
  for (const request of requests) {
    validateAuthorizationCommentTime(found.get(request.commentId), request.authorizedAt ?? null);
  }
  return found;
}

export function fetchVerifiedGitHubAuthorizationComment({
  repository,
  commentId,
  authorizedAt,
  runtime,
  runGh = defaultRunGh,
}) {
  validateRequest(repository, commentId);
  const timeout = takeWorkRunVerificationQuery(runtime);
  const result = runGh(['api', `/repos/${repository}/issues/comments/${commentId}`], {
    timeout: Math.min(GITHUB_COMMENT_TIMEOUT_MS, timeout),
    maxBuffer: GITHUB_COMMENT_MAX_BYTES,
  });
  const comment = parseFetchedComment(verifiedCommentOutput(result), commentId);
  validateAuthorizationCommentTime(comment, authorizedAt);
  verifyCommentWasNeverEdited(comment, commentId, runGh, runtime);
  return comment;
}
