import { MAX_RANGE_COMMITS, MAX_RANGE_RECEIPTS } from './work-run-validation-foundation.mjs';

const PAGE_SIZE = 100;
const MAX_PAGES = Math.ceil((MAX_RANGE_COMMITS + MAX_RANGE_RECEIPTS) / PAGE_SIZE);

const QUERY = `query WorkRunPullRequestTimeline(
  $owner: String!, $name: String!, $number: Int!, $after: String
) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      timelineItems(
        first: ${PAGE_SIZE}, after: $after,
        itemTypes: [PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT]
      ) {
        nodes {
          __typename
          ... on PullRequestCommit {
            commit { oid message parents(first: 100) { totalCount nodes { oid } } }
          }
          ... on HeadRefForcePushedEvent {
            createdAt
            beforeCommit { oid }
            afterCommit { oid }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function committedNode(node) {
  const commit = node?.commit;
  const parents = commit?.parents;
  if (!parents || parents.totalCount !== parents.nodes?.length) {
    throw new Error('GitHub GraphQL committed parent evidence is incomplete');
  }
  return {
    event: 'committed',
    sha: commit.oid,
    message: commit.message,
    parents: parents.nodes.map(({ oid }) => ({ sha: oid })),
  };
}

function timelineNode(node) {
  if (node?.__typename === 'PullRequestCommit') return committedNode(node);
  if (node?.__typename === 'HeadRefForcePushedEvent') {
    return {
      event: 'head_ref_force_pushed',
      before: node.beforeCommit?.oid,
      after: node.afterCommit?.oid,
      createdAt: node.createdAt,
    };
  }
  throw new Error('GitHub GraphQL pull-request timeline contains an unexpected node');
}

function queryArgs(repository, number, cursor) {
  const [owner, name] = repository.split('/');
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${number}`,
  ];
  if (cursor !== null) args.push('-f', `after=${cursor}`);
  return args;
}

export function pullRequestTimeline(repository, number, queryJson) {
  const events = [];
  let commitCount = 0;
  let forcePushCount = 0;
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = queryJson(queryArgs(repository, number, cursor));
    if (
      response !== null &&
      typeof response === 'object' &&
      Object.hasOwn(response, 'errors') &&
      (!Array.isArray(response.errors) || response.errors.length > 0)
    ) {
      throw new Error('GitHub GraphQL errors make the pull-request timeline incomplete');
    }
    const timeline = response?.data?.repository?.pullRequest?.timelineItems;
    if (!Array.isArray(timeline?.nodes)) {
      throw new Error('GitHub GraphQL pull-request timeline is incomplete');
    }
    const pageInfo = timeline.pageInfo;
    if (
      pageInfo === null ||
      typeof pageInfo !== 'object' ||
      Array.isArray(pageInfo) ||
      Object.keys(pageInfo).sort().join(',') !== 'endCursor,hasNextPage' ||
      typeof pageInfo?.hasNextPage !== 'boolean' ||
      (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== 'string')
    ) {
      throw new Error('GitHub GraphQL pull-request timeline pageInfo is incomplete');
    }
    const pageEvents = timeline.nodes.map(timelineNode);
    commitCount += pageEvents.filter((event) => event.event === 'committed').length;
    forcePushCount += pageEvents.filter((event) => event.event === 'head_ref_force_pushed').length;
    if (commitCount > MAX_RANGE_COMMITS || forcePushCount > MAX_RANGE_RECEIPTS) {
      throw new Error('GitHub GraphQL pull-request timeline exceeds the evidence budget');
    }
    events.push(...pageEvents);
    if (!pageInfo.hasNextPage) return events;
    if (typeof pageInfo.endCursor !== 'string' || !pageInfo.endCursor) {
      throw new Error('GitHub GraphQL pull-request timeline cursor is invalid');
    }
    cursor = pageInfo.endCursor;
  }
  throw new Error('GitHub GraphQL pull-request timeline exceeds the evidence budget');
}
