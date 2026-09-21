// harness-coverage: post-findings-github-comment-verification.mjs
// harness-coverage: post-findings-approver-policy.mjs
import { describe, expect, it, vi } from 'vitest';

import {
  auditCloseoutReceipts,
  fetchCloseoutAudit,
  fetchPostFindingsAuthorizations,
  fetchPostFindingsAuthorization,
  parseDeliveryCompletionReceipt,
  parseMergeDecisionReceipt,
  parsePostFindingsAuthorizationEnvelope,
  parsePostFindingsAuthorization,
  selectPostFindingsAuthorization,
} from '../post-findings-authorization.mjs';
import { createVerificationRuntime } from '../verification-budget-runtime.mjs';

const head = 'a'.repeat(40);
const body = `POST_FINDINGS_ACTION_REQUEST
PR: 42
HEAD: ${head}
VERDICT: 0
ACTION: push
GROUND: red-check
EVIDENCE: https://example.test/check
SCOPE: scripts/harness
APPROVED: yes
APPROVED-BY: @woojubb`;

const envelope = {
  id: 7,
  url: 'https://github.com/woojubb/robota/issues/42#issuecomment-7',
  author: { login: 'woojubb', association: 'OWNER' },
  body,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
};

const mergeHead = 'b'.repeat(40);
const mergeBase = 'c'.repeat(40);
const mergeCommit = 'd'.repeat(40);
const mergeDecisionBody = `PR_MERGE_DECISION
PR: 42
HEAD: ${mergeHead}
BASE: develop
BASE-OID: ${mergeBase}
VERDICT: 0
CI-OBSERVER: ci-gate-watch
CI-RESULT: GREEN
REMOTE-FEEDBACK: empty
SCOPE: PROC-2724
AUTHORITY: owner-delegated
AUTHORITY-EVIDENCE: https://github.com/woojubb/robota/issues/2724
APPROVED: yes
APPROVED-BY: agent:Codex (owner-delegated)`;
const completionBody = `DELIVERY_COMPLETION_RECORD
OUTCOME: closed
ISSUE: 2724
PR: 42
HEAD: ${mergeHead}
MERGE: ${mergeCommit}
BASE: develop
LANDING: verified
BRANCH: deleted
BRANCH-DETAIL: fix/2724-closeout-protocol
BASE-RESET: develop@${mergeCommit}
CRITERIA: delivered
ACTION: close`;

function closeoutEnvelope(id, number, body, createdAt) {
  return {
    id,
    url: `https://github.com/woojubb/robota/issues/${number}#issuecomment-${id}`,
    author: { login: 'woojubb', association: 'OWNER' },
    body,
    createdAt,
    updatedAt: createdAt,
    lastEditedAt: null,
  };
}

describe('post-findings authorization', () => {
  it('fetches up to one hundred authorization comments in one bounded GraphQL page', () => {
    const requests = Array.from({ length: 100 }, (_, index) => ({
      commentId: index + 1,
      authorizedAt: '2026-08-30T00:00:01Z',
    }));
    const calls = [];
    const authorizations = fetchPostFindingsAuthorizations({
      repository: 'woojubb/robota',
      prNumber: 42,
      requests,
      runGh: (args, options) => {
        calls.push({ args, options });
        return {
          status: 0,
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  comments: {
                    nodes: requests.map(({ commentId }) => ({
                      databaseId: commentId,
                      url: `https://github.com/woojubb/robota/pull/42#issuecomment-${commentId}`,
                      body: body.replace('issuecomment-7', `issuecomment-${commentId}`),
                      authorAssociation: 'OWNER',
                      createdAt: envelope.createdAt,
                      lastEditedAt: null,
                      author: { login: 'woojubb' },
                    })),
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          }),
          stderr: '',
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('graphql');
    expect(calls[0].args).toContain('number=42');
    expect(authorizations).toHaveLength(100);
    expect(authorizations[0]).toMatchObject({ commentId: 1, prNumber: 42 });
    expect(authorizations.at(-1)).toMatchObject({ commentId: 100, prNumber: 42 });
  });

  it('rejects incomplete or unapproved projections', () => {
    expect(
      parsePostFindingsAuthorization(body.replace('APPROVED: yes', 'APPROVED: no')),
    ).toBeNull();
    expect(parsePostFindingsAuthorization(body.replace('EVIDENCE:', 'MISSING:'))).toBeNull();
  });

  it('accepts only the canonical action and ground relationships', () => {
    expect(parsePostFindingsAuthorization(body)).toMatchObject({
      action: 'push',
      ground: 'red-check',
    });
    expect(
      parsePostFindingsAuthorization(body.replace('GROUND: red-check', 'GROUND: finding')),
    ).toMatchObject({ action: 'push', ground: 'finding' });
    expect(
      parsePostFindingsAuthorization(
        body.replace('ACTION: push\nGROUND: red-check', 'ACTION: rebase\nGROUND: rebase'),
      ),
    ).toMatchObject({ action: 'rebase', ground: 'rebase' });

    expect(
      parsePostFindingsAuthorization(body.replace('GROUND: red-check', 'GROUND: rebase')),
    ).toBeNull();
    expect(
      parsePostFindingsAuthorization(
        body
          .replace('ACTION: push', 'ACTION: rebase')
          .replace('GROUND: red-check', 'GROUND: finding'),
      ),
    ).toBeNull();
    expect(
      parsePostFindingsAuthorization(body.replace('ACTION: push', 'ACTION: rebase')),
    ).toBeNull();
  });

  it('projects one trusted immutable comment envelope', () => {
    expect(parsePostFindingsAuthorizationEnvelope(envelope)).toEqual({
      prNumber: 42,
      head,
      verdict: 0,
      action: 'push',
      ground: 'red-check',
      evidence: 'https://example.test/check',
      scope: 'scripts/harness',
      approvedBy: '@woojubb',
      commentId: 7,
      commentUrl: envelope.url,
      commentAuthor: 'woojubb',
      commentAuthorAssociation: 'OWNER',
    });
  });

  it('rejects spoofed or untrusted approvals', () => {
    expect(
      parsePostFindingsAuthorizationEnvelope({
        ...envelope,
        author: { login: 'attacker', association: 'OWNER' },
      }),
    ).toBeNull();
    expect(
      parsePostFindingsAuthorizationEnvelope({
        ...envelope,
        author: { login: 'woojubb', association: 'CONTRIBUTOR' },
      }),
    ).toBeNull();
    for (const association of ['MEMBER', 'COLLABORATOR']) {
      expect(
        parsePostFindingsAuthorizationEnvelope({
          ...envelope,
          author: { login: 'org-member', association },
          body: body.replace('@woojubb', '@org-member'),
        }),
      ).toBeNull();
    }
    expect(parsePostFindingsAuthorizationEnvelope({ ...envelope, id: '7' })).toBeNull();
  });

  it('fetches one exact numeric GitHub comment through a bounded request', () => {
    const calls = [];
    const authorization = fetchPostFindingsAuthorization({
      repository: 'woojubb/robota',
      commentId: 7,
      runGh: (args, options) => {
        calls.push({ args, options });
        return {
          status: 0,
          stdout: JSON.stringify(
            args.includes('graphql')
              ? {
                  data: {
                    node: {
                      __typename: 'IssueComment',
                      databaseId: envelope.id,
                      lastEditedAt: null,
                    },
                  },
                }
              : {
                  id: envelope.id,
                  node_id: 'IC_kwDOExample',
                  html_url: envelope.url,
                  user: { login: envelope.author.login },
                  author_association: envelope.author.association,
                  body: envelope.body,
                  created_at: envelope.createdAt,
                  updated_at: envelope.updatedAt,
                },
          ),
          stderr: '',
        };
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      args: ['api', '/repos/woojubb/robota/issues/comments/7'],
      options: { timeout: 10_000, maxBuffer: 262_144 },
    });
    expect(calls[1].args).toContain('graphql');
    expect(calls[1].args).toContain('nodeId=IC_kwDOExample');
    expect(authorization).toMatchObject({
      prNumber: 42,
      commentId: 7,
      commentUrl: envelope.url,
      commentAuthor: 'woojubb',
    });
  });

  it('rejects edited, malformed, or post-boundary authorization comments', () => {
    const fetched = (overrides = {}) => ({
      status: 0,
      stdout: JSON.stringify({
        id: envelope.id,
        html_url: envelope.url,
        user: { login: envelope.author.login },
        author_association: envelope.author.association,
        body: envelope.body,
        created_at: envelope.createdAt,
        updated_at: envelope.updatedAt,
        ...overrides,
      }),
      stderr: '',
    });
    const request = {
      repository: 'woojubb/robota',
      commentId: 7,
      authorizedAt: '2026-08-30T00:00:01Z',
    };

    expect(() =>
      fetchPostFindingsAuthorization({
        ...request,
        runGh: () => fetched({ updated_at: '2026-08-30T00:00:01Z' }),
      }),
    ).toThrow(/edited/i);
    expect(() =>
      fetchPostFindingsAuthorization({
        ...request,
        runGh: () => fetched({ created_at: 'not-an-instant', updated_at: 'not-an-instant' }),
      }),
    ).toThrow(/timestamp/i);
    expect(() =>
      fetchPostFindingsAuthorization({
        ...request,
        runGh: () =>
          fetched({
            created_at: '2026-08-30T00:00:02Z',
            updated_at: '2026-08-30T00:00:02Z',
          }),
      }),
    ).toThrow(/authorized work boundary/i);
  });

  it('rejects an authorization comment with an explicit GraphQL edit signal', () => {
    expect(() =>
      fetchPostFindingsAuthorization({
        repository: 'woojubb/robota',
        commentId: 7,
        runGh: (args) => ({
          status: 0,
          stdout: JSON.stringify(
            args.includes('graphql')
              ? {
                  data: {
                    node: {
                      __typename: 'IssueComment',
                      databaseId: 7,
                      lastEditedAt: '2026-08-30T00:00:00Z',
                    },
                  },
                }
              : {
                  id: 7,
                  node_id: 'IC_kwDOExample',
                  html_url: envelope.url,
                  user: { login: envelope.author.login },
                  author_association: envelope.author.association,
                  body: envelope.body,
                  created_at: envelope.createdAt,
                  updated_at: envelope.updatedAt,
                },
          ),
          stderr: '',
        }),
      }),
    ).toThrow(/edited/i);
  });

  it('fails without invoking GitHub when the shared query budget is exhausted', () => {
    const runGh = vi.fn();
    expect(() =>
      fetchPostFindingsAuthorization({
        repository: 'woojubb/robota',
        commentId: 7,
        runGh,
        runtime: createVerificationRuntime({ queryBudget: 0 }),
      }),
    ).toThrow('verification query budget exhausted');
    expect(runGh).not.toHaveBeenCalled();
  });

  it('fails closed for a mismatched, malformed, oversized, or unavailable live comment', () => {
    const request = {
      repository: 'woojubb/robota',
      commentId: 7,
    };
    expect(() =>
      fetchPostFindingsAuthorization({
        ...request,
        runGh: () => ({
          status: 0,
          stdout: JSON.stringify({
            id: 8,
            html_url: envelope.url,
            user: { login: 'woojubb' },
            author_association: 'OWNER',
            body,
          }),
          stderr: '',
        }),
      }),
    ).toThrow(/comment identity/i);
    expect(() =>
      fetchPostFindingsAuthorization({
        ...request,
        runGh: () => ({ status: 0, stdout: '{', stderr: '' }),
      }),
    ).toThrow(/response/i);
    expect(() =>
      fetchPostFindingsAuthorization({
        ...request,
        runGh: () => ({ status: 0, stdout: 'x'.repeat(262_145), stderr: '' }),
      }),
    ).toThrow(/size/i);
    expect(() =>
      fetchPostFindingsAuthorization({
        ...request,
        runGh: () => ({ status: 1, stdout: '', stderr: 'offline' }),
      }),
    ).toThrow(/failed/i);
  });

  it('preserves bounded runner failures while fetch validation is split into stages', () => {
    const request = { repository: 'woojubb/robota', commentId: 7 };
    for (const [error, message] of [
      [{ code: 'ETIMEDOUT' }, /timed out/i],
      [{ code: 'ENOBUFS' }, /size limit/i],
      [{ code: 'EIO', message: 'transport broke' }, /transport broke/i],
    ]) {
      expect(() =>
        fetchPostFindingsAuthorization({
          ...request,
          runGh: () => ({ status: null, stdout: '', stderr: '', error }),
        }),
      ).toThrow(message);
    }
  });

  it('rejects ambiguous request markers and duplicate fields', () => {
    expect(
      parsePostFindingsAuthorizationEnvelope({ ...envelope, body: `${body}\n${body}` }),
    ).toBeNull();
    expect(
      parsePostFindingsAuthorizationEnvelope({
        ...envelope,
        body: body.replace('HEAD:', `HEAD: ${'b'.repeat(40)}\nHEAD:`),
      }),
    ).toBeNull();
  });

  it('selects one immutable comment identity bound to every expected field', () => {
    expect(
      selectPostFindingsAuthorization({
        comments: [envelope],
        prNumber: 42,
        head,
        verdict: 0,
        action: 'push',
        ground: 'red-check',
      }),
    ).toMatchObject({ ok: true, prNumber: 42, commentId: 7, ground: 'red-check' });
  });

  it('rejects expected-field mismatches and multiple matching comments', () => {
    const expected = {
      comments: [envelope],
      prNumber: 42,
      head,
      verdict: 0,
      action: 'push',
      ground: 'red-check',
    };
    for (const mismatch of [
      { prNumber: 43 },
      { head: 'b'.repeat(40) },
      { verdict: 1 },
      { action: 'rebase' },
      { ground: 'finding' },
    ]) {
      expect(selectPostFindingsAuthorization({ ...expected, ...mismatch })).toMatchObject({
        ok: false,
        reason: 'missing-authorization',
      });
    }
    expect(
      selectPostFindingsAuthorization({
        ...expected,
        comments: [
          envelope,
          {
            ...envelope,
            id: 8,
            url: 'https://github.com/woojubb/robota/issues/42#issuecomment-8',
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: 'ambiguous-authorization' });
  });
});

describe('single-pass remote closeout receipts', () => {
  const mergeComment = closeoutEnvelope(81, 42, mergeDecisionBody, '2026-09-13T10:00:00Z');
  const completionComment = closeoutEnvelope(82, 2724, completionBody, '2026-09-13T10:06:00Z');
  const projection = {
    repository: 'woojubb/robota',
    pr: {
      number: 42,
      state: 'MERGED',
      headRefOid: mergeHead,
      baseRefName: 'develop',
      baseRefOid: 'e'.repeat(40),
      mergeCommit: { oid: mergeCommit },
      mergedAt: '2026-09-13T10:05:00Z',
    },
    mergeParentOid: mergeBase,
    issue: { number: 2724, state: 'CLOSED' },
    mergeComments: [mergeComment],
    completionComments: [completionComment],
  };

  it('parses the two canonical receipt forms', () => {
    expect(parseMergeDecisionReceipt(mergeDecisionBody)).toMatchObject({
      prNumber: 42,
      head: mergeHead,
      base: 'develop',
      baseOid: mergeBase,
      verdict: 0,
      ciObserver: 'ci-gate-watch',
      remoteFeedback: 'empty',
    });
    expect(parseDeliveryCompletionReceipt(completionBody)).toMatchObject({
      outcome: 'closed',
      issueNumber: 2724,
      prNumber: 42,
      mergeCommit,
      action: 'close',
    });
  });

  it.each([
    [
      'open-partial',
      completionBody
        .replace('OUTCOME: closed', 'OUTCOME: open-partial')
        .replace('CRITERIA: delivered', 'CRITERIA: remaining:TC-05')
        .replace('ACTION: close', 'ACTION: leave-open'),
      { outcome: 'open-partial', issueNumber: 2724, action: 'leave-open' },
    ],
    [
      'no-issue',
      completionBody
        .replace('OUTCOME: closed', 'OUTCOME: no-issue')
        .replace('ISSUE: 2724', 'ISSUE: none')
        .replace('CRITERIA: delivered', 'CRITERIA: none')
        .replace('ACTION: close', 'ACTION: none'),
      { outcome: 'no-issue', issueNumber: null, action: 'none' },
    ],
  ])('parses the canonical %s completion outcome', (_name, receipt, expected) => {
    expect(parseDeliveryCompletionReceipt(receipt)).toMatchObject(expected);
  });

  it('accepts one exact, ordered, state-consistent receipt pair', () => {
    expect(auditCloseoutReceipts(projection)).toMatchObject({
      ok: true,
      mergeDecision: { commentId: 81 },
      completion: { commentId: 82 },
    });
  });

  it('selects the current PR completion from repeated umbrella deliveries', () => {
    const previousCompletion = closeoutEnvelope(
      80,
      2724,
      completionBody
        .replace('PR: 42', 'PR: 41')
        .replace(`HEAD: ${mergeHead}`, `HEAD: ${'9'.repeat(40)}`)
        .replace(`MERGE: ${mergeCommit}`, `MERGE: ${'8'.repeat(40)}`),
      '2026-09-12T10:06:00Z',
    );

    expect(
      auditCloseoutReceipts({
        ...projection,
        completionComments: [previousCompletion, completionComment],
      }),
    ).toMatchObject({
      ok: true,
      completion: { commentId: 82, prNumber: 42 },
    });
  });

  it('still refuses multiple completion receipts for the current PR', () => {
    expect(
      auditCloseoutReceipts({
        ...projection,
        completionComments: [
          completionComment,
          closeoutEnvelope(83, 2724, completionBody, '2026-09-13T10:07:00Z'),
        ],
      }),
    ).toEqual({ ok: false, reason: 'ambiguous-completion' });
  });

  it('binds direct approval to the trusted comment author', () => {
    const directBody = mergeDecisionBody
      .replace('AUTHORITY: owner-delegated', 'AUTHORITY: direct')
      .replace('APPROVED-BY: agent:Codex (owner-delegated)', 'APPROVED-BY: @another-owner');
    expect(
      auditCloseoutReceipts({
        ...projection,
        mergeComments: [closeoutEnvelope(81, 42, directBody, '2026-09-13T10:00:00Z')],
      }),
    ).toEqual({ ok: false, reason: 'missing-merge-decision' });
  });

  it('reads the exact immutable comments and live PR/issue projections within one bounded pass', () => {
    const calls = [];
    const comments = new Map([
      [81, mergeComment],
      [82, completionComment],
    ]);
    const asViewComment = (comment) => ({
      url: comment.url,
      author: { login: comment.author.login },
      authorAssociation: comment.author.association,
      body: comment.body,
      createdAt: comment.createdAt,
      includesCreatedEdit: false,
    });
    const prComments = [asViewComment(mergeComment)];
    const issueComments = [asViewComment(completionComment)];
    const asApiComment = (comment) => ({
      id: Number(/#issuecomment-(\d+)$/.exec(comment.url)?.[1]),
      html_url: comment.url,
      user: { login: comment.author.login },
      author_association: comment.authorAssociation,
      body: comment.body,
      created_at: comment.createdAt,
      updated_at: comment.createdAt,
    });
    const runGh = (args) => {
      calls.push(args);
      if (args[0] === 'api' && /^\/repos\/.+\/issues\/comments\/(81|82)$/.test(args[1])) {
        const id = Number(args[1].split('/').at(-1));
        const comment = comments.get(id);
        return {
          status: 0,
          stdout: JSON.stringify({
            id,
            node_id: `node-${id}`,
            html_url: comment.url,
            user: { login: comment.author.login },
            author_association: comment.author.association,
            body: comment.body,
            created_at: comment.createdAt,
            updated_at: comment.updatedAt,
          }),
          stderr: '',
        };
      }
      if (args[0] === 'api' && args[1] === 'graphql') {
        const id = Number(
          args
            .find((arg) => arg.startsWith('nodeId=node-'))
            .split('-')
            .at(-1),
        );
        return {
          status: 0,
          stdout: JSON.stringify({
            data: { node: { __typename: 'IssueComment', databaseId: id, lastEditedAt: null } },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'api' && args.includes('--paginate')) {
        const surface = args[1].includes('/issues/42/') ? prComments : issueComments;
        return {
          status: 0,
          stdout: JSON.stringify([surface.map(asApiComment)]),
          stderr: '',
        };
      }
      if (args[0] === 'pr') return { status: 0, stdout: JSON.stringify(projection.pr), stderr: '' };
      if (args[0] === 'api' && args[1] === `repos/woojubb/robota/git/commits/${mergeCommit}`) {
        return {
          status: 0,
          stdout: JSON.stringify({ sha: mergeCommit, parents: [{ sha: mergeBase }] }),
          stderr: '',
        };
      }
      if (args[0] === 'issue')
        return { status: 0, stdout: JSON.stringify(projection.issue), stderr: '' };
      throw new Error(`unexpected gh call: ${args.join(' ')}`);
    };
    const request = {
      repository: 'woojubb/robota',
      prNumber: 42,
      issueNumber: 2724,
      mergeCommentId: 81,
      completionCommentId: 82,
      runGh,
    };
    const result = fetchCloseoutAudit({
      ...request,
      runtime: createVerificationRuntime({ queryBudget: 9 }),
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(9);
    expect(calls.filter((args) => args.includes('--paginate'))).toHaveLength(2);

    prComments.push({
      ...asViewComment(mergeComment),
      url: 'https://github.com/woojubb/robota/pull/42#issuecomment-83',
    });
    expect(
      fetchCloseoutAudit({
        ...request,
        runtime: createVerificationRuntime({ queryBudget: 9 }),
      }),
    ).toEqual({ ok: false, reason: 'ambiguous-merge-decision' });
  });

  it.each([
    ['missing merge decision', { mergeComments: [] }, 'missing-merge-decision'],
    [
      'duplicate merge decision',
      { mergeComments: [mergeComment, mergeComment] },
      'ambiguous-merge-decision',
    ],
    [
      'edited merge decision',
      { mergeComments: [{ ...mergeComment, lastEditedAt: '2026-09-13T10:01:00Z' }] },
      'missing-merge-decision',
    ],
    [
      'stale head',
      { pr: { ...projection.pr, headRefOid: 'e'.repeat(40) } },
      'merge-decision-state-mismatch',
    ],
    [
      'wrong merge commit',
      { pr: { ...projection.pr, mergeCommit: { oid: 'e'.repeat(40) } } },
      'completion-state-mismatch',
    ],
    ['wrong merge parent', { mergeParentOid: 'e'.repeat(40) }, 'merge-decision-state-mismatch'],
    [
      'open issue for closed outcome',
      { issue: { number: 2724, state: 'OPEN' } },
      'completion-state-mismatch',
    ],
    [
      'completion before merge',
      {
        completionComments: [
          {
            ...completionComment,
            createdAt: '2026-09-13T10:04:00Z',
            updatedAt: '2026-09-13T10:04:00Z',
          },
        ],
      },
      'completion-state-mismatch',
    ],
  ])('refuses %s', (_name, override, reason) => {
    expect(auditCloseoutReceipts({ ...projection, ...override })).toEqual({ ok: false, reason });
  });

  it.each([
    mergeDecisionBody.replace('CI-RESULT: GREEN', 'CI-RESULT: RED'),
    mergeDecisionBody.replace('REMOTE-FEEDBACK: empty', 'REMOTE-FEEDBACK: unknown'),
    mergeDecisionBody.replace('APPROVED: yes', 'APPROVED: no'),
    completionBody.replace('OUTCOME: closed', 'OUTCOME: complete'),
    completionBody.replace('LANDING: verified', 'LANDING: assumed'),
  ])('rejects malformed or non-terminal receipt bodies', (body) => {
    expect(
      body.startsWith('PR_MERGE_DECISION')
        ? parseMergeDecisionReceipt(body)
        : parseDeliveryCompletionReceipt(body),
    ).toBeNull();
  });
});
