// harness-coverage: post-findings-github-comment-verification.mjs
import { describe, expect, it, vi } from 'vitest';

import {
  fetchPostFindingsAuthorizations,
  fetchPostFindingsAuthorization,
  parsePostFindingsAuthorizationEnvelope,
  parsePostFindingsAuthorization,
  selectPostFindingsAuthorization,
} from '../post-findings-authorization.mjs';
import { createWorkRunVerificationRuntime } from '../work-run-verification-runtime.mjs';

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
APPROVED-BY: @maintainer`;

const envelope = {
  id: 7,
  url: 'https://github.com/woojubb/robota/issues/42#issuecomment-7',
  author: { login: 'maintainer', association: 'OWNER' },
  body,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:00Z',
};

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
                      author: { login: 'maintainer' },
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
      approvedBy: '@maintainer',
      commentId: 7,
      commentUrl: envelope.url,
      commentAuthor: 'maintainer',
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
        author: { login: 'maintainer', association: 'CONTRIBUTOR' },
      }),
    ).toBeNull();
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
      commentAuthor: 'maintainer',
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
        runtime: createWorkRunVerificationRuntime({ queryBudget: 0 }),
      }),
    ).toThrow('work-run verification query budget exhausted');
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
            user: { login: 'maintainer' },
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
