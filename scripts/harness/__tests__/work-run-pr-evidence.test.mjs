// harness-coverage: work-run-remote-closure-evidence.mjs
// harness-coverage: work-run-pr-timeline.mjs
// harness-coverage: work-run-opening-head-history.mjs
// harness-coverage: work-run-pr-body.mjs
// harness-coverage: work-run-commit-trailers.mjs
// harness-coverage: work-run-pr-ancestry.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  createPullRequestEvidenceFetcher,
  resolvePullRequestHistoryContext,
} from '../work-run-pr-evidence.mjs';
import {
  attestedOpeningHead,
  createOpeningHeadComment,
} from '../work-run-opening-head-evidence.mjs';
import { pullRequestTimeline } from '../work-run-pr-timeline.mjs';
import {
  appendWorkRunEvent,
  cohortKey,
  createInitialWorkRun,
  projectWorkRunDurations,
  reduceWorkRun,
} from '../work-run-contract.mjs';
import { validateRemoteOpeningClosure } from '../work-run-remote-closure-evidence.mjs';

// harness-coverage: work-run-opening-head-evidence.mjs

const INITIAL_HEAD = '1'.repeat(40);
const CURRENT_HEAD = '2'.repeat(40);
const NORMAL_HEAD = '3'.repeat(40);
const FORCED_HEAD = '4'.repeat(40);
const HYDRATED_HEAD = '5'.repeat(40);
const PR_CREATED_AT = '2026-08-30T00:00:00Z';
const ATTESTED_AT = '2026-08-29T23:59:55Z';
const OPENING_PARENT = '9'.repeat(40);
const RECEIPT_BLOB = 'a'.repeat(40);

function openingReceipt() {
  let run = createInitialWorkRun({
    runId: 'run-1',
    at: '2026-08-29T23:59:40Z',
    branch: 'codex/work',
  });
  run = appendWorkRunEvent(run, {
    type: 'work.bound',
    at: '2026-08-29T23:59:41Z',
    data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'harness' },
  });
  run = appendWorkRunEvent(run, { type: 'work.started', at: '2026-08-29T23:59:42Z' });
  run = appendWorkRunEvent(run, {
    type: 'work.ready',
    at: '2026-08-29T23:59:43Z',
    data: { generation: 0, revision: 0 },
  });
  const state = reduceWorkRun(run.events);
  return {
    schemaVersion: 1,
    disposition: 'included',
    runId: 'run-1',
    generation: 0,
    revision: 0,
    identity: { headCommit: OPENING_PARENT },
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    cohort: { key: cohortKey(state), lane: state.lane, workKind: state.workKind },
    timestamps: { claimedAt: run.events[0].at, readyAt: run.events.at(-1).at },
  };
}

function excludedOpeningReceipt() {
  let run = createInitialWorkRun({
    runId: 'run-1',
    at: '2026-08-29T23:59:40Z',
    branch: 'codex/work',
  });
  run = appendWorkRunEvent(run, {
    type: 'work.bound',
    at: '2026-08-29T23:59:41Z',
    data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'harness' },
  });
  run = appendWorkRunEvent(run, {
    type: 'work.excluded',
    at: '2026-08-29T23:59:42Z',
    data: { reason: 'pure-planning-range' },
  });
  const state = reduceWorkRun(run.events);
  return {
    schemaVersion: 1,
    disposition: 'excluded',
    reason: 'pure-planning-range',
    runId: 'run-1',
    generation: 0,
    revision: 0,
    identity: { headCommit: OPENING_PARENT },
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    cohort: { key: cohortKey(state), lane: state.lane, workKind: state.workKind },
    timestamps: { claimedAt: run.events[0].at, excludedAt: run.events.at(-1).at },
  };
}

function remoteOpeningClosure(receipt) {
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
  return validateRemoteOpeningClosure({
    headOid: INITIAL_HEAD,
    runId: 'run-1',
    commit: {
      sha: INITIAL_HEAD,
      commit: { message: g0Message() },
      parents: [{ sha: OPENING_PARENT }],
      files: [
        {
          filename: '.agents/evals/work-runs/run-1/g0-r0.json',
          status: 'added',
          sha: RECEIPT_BLOB,
        },
      ],
    },
    content: {
      type: 'file',
      path: '.agents/evals/work-runs/run-1/g0-r0.json',
      sha: RECEIPT_BLOB,
      encoding: 'base64',
      content: bytes.toString('base64'),
    },
  });
}

const OPENING_RECEIPT_BYTES = Buffer.from(`${JSON.stringify(openingReceipt())}\n`);
const OPENING_RECEIPT_DIGEST = createHash('sha256').update(OPENING_RECEIPT_BYTES).digest('hex');

function committed(sha, message, parents = []) {
  return { event: 'committed', sha, message, parents: parents.map((parent) => ({ sha: parent })) };
}

function g0Message(label = 'initial') {
  return `${label}\n\nWork-Run: run-1\nWork-Receipt: g0-r0`;
}

function repository() {
  const root = makeTemp('work-run-pr-evidence-');
  execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:woojubb/robota.git'], {
    cwd: root,
  });
  return root;
}

function response(value) {
  return { status: 0, stdout: JSON.stringify(value), stderr: '' };
}

function openingComment(openedHead = INITIAL_HEAD, overrides = {}) {
  return {
    id: 11,
    commit_id: openedHead,
    body: `Work-Run-Opening-Head: v1\nWork-Run: run-1\nHead-Oid: ${openedHead}`,
    created_at: ATTESTED_AT,
    updated_at: ATTESTED_AT,
    ...overrides,
  };
}

function evidenceRunner(timeline, { currentHead = CURRENT_HEAD, openedHead = INITIAL_HEAD } = {}) {
  return (_command, args) => {
    const endpoint = args.at(-1);
    if (args.includes('graphql')) {
      const nodes = timeline.map((event) => {
        if (event.event === 'committed') {
          return {
            __typename: 'PullRequestCommit',
            commit: {
              oid: event.sha,
              message: event.message,
              parents: {
                totalCount: event.parents.length,
                nodes: event.parents.map(({ sha }) => ({ oid: sha })),
              },
            },
          };
        }
        if (event.event === 'head_ref_force_pushed') {
          return {
            __typename: 'HeadRefForcePushedEvent',
            createdAt: '2026-08-30T00:00:01Z',
            beforeCommit: { oid: event.before_commit?.sha ?? event.before },
            afterCommit: { oid: event.after_commit?.sha ?? event.after },
          };
        }
        return { __typename: event.__typename ?? 'UnexpectedNode' };
      });
      return response({
        data: {
          repository: {
            pullRequest: {
              timelineItems: {
                nodes,
                pageInfo: {
                  hasNextPage: nodes.length === 100,
                  endCursor: nodes.length === 100 ? 'cursor' : null,
                },
              },
            },
          },
        },
      });
    }
    if (endpoint.includes('/comments?')) {
      const commentHead = /\/commits\/([0-9a-f]+)\/comments\?/u.exec(endpoint)?.[1];
      return response(commentHead === openedHead ? [openingComment(openedHead)] : []);
    }
    if (endpoint.includes('/contents/')) {
      return response({
        type: 'file',
        path: '.agents/evals/work-runs/run-1/g0-r0.json',
        sha: RECEIPT_BLOB,
        encoding: 'base64',
        content: OPENING_RECEIPT_BYTES.toString('base64'),
      });
    }
    if (endpoint.endsWith(`/commits/${openedHead}`)) {
      return response({
        sha: openedHead,
        commit: { message: g0Message() },
        parents: [{ sha: OPENING_PARENT }],
        files: [
          {
            filename: '.agents/evals/work-runs/run-1/g0-r0.json',
            status: 'added',
            sha: RECEIPT_BLOB,
          },
        ],
      });
    }
    return response({
      created_at: PR_CREATED_AT,
      body: 'Summary\n\nLane: L2\nWork-Run: run-1',
      head: { sha: currentHead, ref: 'codex/work' },
    });
  };
}

function successfulRunner(command, args) {
  return evidenceRunner([
    committed(INITIAL_HEAD, g0Message()),
    {
      event: 'head_ref_force_pushed',
      before_commit: { sha: INITIAL_HEAD },
      after_commit: { sha: CURRENT_HEAD },
    },
    committed(CURRENT_HEAD, 'fix: authorized rework'),
  ])(command, args);
}

describe('pull-request head evidence', () => {
  it.each([
    ['missing', 'Summary only'],
    ['mismatched', 'Work-Run: another-run'],
    ['duplicate', 'Work-Run: run-1\nWork-Run: run-1'],
    ['non-terminal', 'Work-Run: run-1\nLater prose'],
  ])('rejects a %s PR body Work-Run marker', (_case, body) => {
    const base = successfulRunner;
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        const endpoint = args.at(-1);
        if (endpoint.endsWith('/pulls/7')) {
          return response({
            created_at: PR_CREATED_AT,
            body,
            head: { sha: CURRENT_HEAD, ref: 'codex/work' },
          });
        }
        return base(command, args);
      },
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/PR body.*Work-Run/u);
  });

  it('accepts valid excluded and state-lost opening receipt dispositions', () => {
    expect(remoteOpeningClosure(excludedOpeningReceipt())).toMatchObject({
      receiptPath: '.agents/evals/work-runs/run-1/g0-r0.json',
    });
    expect(
      remoteOpeningClosure({
        schemaVersion: 1,
        disposition: 'invalid',
        reason: 'state-lost',
        runId: 'run-1',
        generation: 0,
        revision: 0,
        identity: {
          repository: 'woojubb/robota',
          branch: 'codex/work',
          baseCommit: '8'.repeat(40),
          headCommit: OPENING_PARENT,
          headTree: '7'.repeat(40),
          commitOids: [OPENING_PARENT],
          trailerDigest: '6'.repeat(64),
          ownerFingerprint: '5'.repeat(64),
        },
        timestamps: { claimedAt: null, readyAt: null },
      }),
    ).toMatchObject({ receiptPath: '.agents/evals/work-runs/run-1/g0-r0.json' });
  });
  it('rejects GraphQL timeline responses carrying top-level errors', () => {
    expect(() =>
      pullRequestTimeline('woojubb/robota', 7, () => ({
        errors: [{ message: 'partial failure' }],
        data: {
          repository: {
            pullRequest: {
              timelineItems: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      })),
    ).toThrow(/GraphQL errors/u);
  });

  it.each([
    ['object', { message: 'partial failure' }],
    ['string', 'partial failure'],
    ['null', null],
  ])('rejects a malformed top-level GraphQL errors %s', (_case, errors) => {
    expect(() =>
      pullRequestTimeline('woojubb/robota', 7, () => ({
        errors,
        data: {
          repository: {
            pullRequest: {
              timelineItems: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      })),
    ).toThrow(/GraphQL errors/u);
  });

  it('rejects incomplete or contradictory GraphQL pageInfo instead of ending pagination', () => {
    const pageInfos = [
      { endCursor: null },
      { hasNextPage: 'false', endCursor: null },
      { hasNextPage: true, endCursor: null },
      { hasNextPage: false },
      { hasNextPage: false, endCursor: null, extra: true },
    ];
    for (const pageInfo of pageInfos) {
      expect(() =>
        pullRequestTimeline('woojubb/robota', 7, () => ({
          data: {
            repository: {
              pullRequest: { timelineItems: { nodes: [], pageInfo } },
            },
          },
        })),
      ).toThrow(/pageInfo|cursor/u);
    }
  });

  it('derives the unique initial receipt from immutable committed timeline history', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: successfulRunner,
    });

    expect(fetchEvidence({ number: 7 })).toEqual({
      status: 'found',
      number: 7,
      firstHeadOid: INITIAL_HEAD,
      currentHeadOid: CURRENT_HEAD,
      runId: 'run-1',
      forcePushEdges: [{ before: INITIAL_HEAD, after: CURRENT_HEAD }],
      openingReceiptDigest: OPENING_RECEIPT_DIGEST,
    });
  });

  it('rejects an opening candidate with more than one Work-Receipt trailer', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner([committed(INITIAL_HEAD, `${g0Message()}\nWork-Receipt: g1-r0`)], {
        currentHead: INITIAL_HEAD,
      }),
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/exactly one Work-Receipt/u);
  });

  it('keeps the original receipt head after a normal fast-forward push', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner([
        committed(INITIAL_HEAD, g0Message()),
        committed(CURRENT_HEAD, 'fix: unapproved normal push', [INITIAL_HEAD]),
      ]),
    });

    expect(fetchEvidence({ number: 7 })).toMatchObject({
      firstHeadOid: INITIAL_HEAD,
      currentHeadOid: CURRENT_HEAD,
      runId: 'run-1',
    });
  });

  it('rejects g0 first added by a normal push after PR creation', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner([
        committed(INITIAL_HEAD, 'feat: PR opened without receipt'),
        committed(CURRENT_HEAD, g0Message('late receipt'), [INITIAL_HEAD]),
      ]),
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/comment is missing/u);
  });

  it('does not accept a generic pull-request run first created by synchronize', () => {
    const timelineRunner = evidenceRunner([
      committed(INITIAL_HEAD, 'feat: opened without receipt'),
      committed(CURRENT_HEAD, g0Message('late receipt'), [INITIAL_HEAD]),
    ]);
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        const endpoint = args.at(-1);
        if (args.includes('graphql')) return timelineRunner(command, args);
        if (endpoint.includes('/comments?')) return response([]);
        if (endpoint.endsWith('/actions/runs')) {
          return response({
            total_count: 1,
            workflow_runs: [
              {
                id: 99,
                event: 'pull_request',
                head_sha: CURRENT_HEAD,
                created_at: '2026-08-30T00:00:05Z',
              },
            ],
          });
        }
        return response({
          created_at: PR_CREATED_AT,
          body: 'Work-Run: run-1',
          head: { sha: CURRENT_HEAD, ref: 'codex/work' },
        });
      },
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/comment is missing/u);
  });

  it('keeps the attested closure when later commits carry the same generation trailer', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner([
        committed(INITIAL_HEAD, g0Message()),
        committed(CURRENT_HEAD, g0Message('forged'), [INITIAL_HEAD]),
      ]),
    });

    expect(fetchEvidence({ number: 7 })).toMatchObject({ firstHeadOid: INITIAL_HEAD });
  });

  it('keeps the attested closure across mixed normal and force pushes', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner([
        committed(INITIAL_HEAD, g0Message()),
        committed(NORMAL_HEAD, 'fix: normal push', [INITIAL_HEAD]),
        {
          event: 'head_ref_force_pushed',
          before_commit: { sha: NORMAL_HEAD },
          after_commit: { sha: FORCED_HEAD },
        },
        committed(FORCED_HEAD, 'fix: force replacement'),
        committed(CURRENT_HEAD, g0Message('forged'), [FORCED_HEAD]),
      ]),
    });

    expect(fetchEvidence({ number: 7 })).toMatchObject({ firstHeadOid: INITIAL_HEAD });
  });

  it('keeps the attested original when an authorized rebase rewrites the g0 closure OID', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner([
        committed(INITIAL_HEAD, g0Message()),
        committed(NORMAL_HEAD, 'fix: generation one', [INITIAL_HEAD]),
        {
          event: 'head_ref_force_pushed',
          before_commit: { sha: NORMAL_HEAD },
          after_commit: { sha: FORCED_HEAD },
        },
        committed(FORCED_HEAD, g0Message()),
        committed(CURRENT_HEAD, 'fix: authorized rebased generation', [FORCED_HEAD]),
      ]),
    });

    expect(fetchEvidence({ number: 7 })).toMatchObject({
      firstHeadOid: INITIAL_HEAD,
      currentHeadOid: CURRENT_HEAD,
      runId: 'run-1',
    });
  });

  it('recovers the old opening segment from GraphQL force-push ancestry', () => {
    const base = evidenceRunner([
      { event: 'head_ref_force_pushed', before: NORMAL_HEAD, after: FORCED_HEAD },
      committed(FORCED_HEAD, 'fix: rewritten root'),
      committed(CURRENT_HEAD, 'fix: current', [FORCED_HEAD]),
    ]);
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        const endpoint = args.at(-1);
        if (endpoint === '/repos/woojubb/robota/commits') {
          return response([
            {
              sha: NORMAL_HEAD,
              commit: { message: 'fix: old segment tip' },
              parents: [{ sha: INITIAL_HEAD }],
            },
            {
              sha: INITIAL_HEAD,
              commit: { message: g0Message() },
              parents: [{ sha: OPENING_PARENT }],
            },
          ]);
        }
        return base(command, args);
      },
    });

    expect(fetchEvidence({ number: 7 })).toMatchObject({
      firstHeadOid: INITIAL_HEAD,
      forcePushEdges: [{ before: NORMAL_HEAD, after: FORCED_HEAD }],
    });
  });

  it('traverses an already-hydrated parent before loading its missing ancestor', () => {
    const base = evidenceRunner([
      committed(NORMAL_HEAD, 'fix: old segment tip', [HYDRATED_HEAD]),
      committed(HYDRATED_HEAD, 'fix: hydrated parent', [INITIAL_HEAD]),
      { event: 'head_ref_force_pushed', before: NORMAL_HEAD, after: FORCED_HEAD },
      committed(FORCED_HEAD, 'fix: rewritten root'),
    ]);
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        const endpoint = args.at(-1);
        if (endpoint === '/repos/woojubb/robota/commits') {
          return response([
            {
              sha: INITIAL_HEAD,
              commit: { message: g0Message() },
              parents: [{ sha: OPENING_PARENT }],
            },
          ]);
        }
        return base(command, args);
      },
    });

    expect(fetchEvidence({ number: 7 })).toMatchObject({ firstHeadOid: INITIAL_HEAD });
  });

  it('recovers an opening head at the 1000-commit validation boundary', () => {
    const historicalOids = Array.from({ length: 1_000 }, (_, index) =>
      (index + 100).toString(16).padStart(40, '0'),
    );
    const openingHead = historicalOids[0];
    const segmentTip = historicalOids.at(-1);
    const base = evidenceRunner(
      [
        { event: 'head_ref_force_pushed', before: segmentTip, after: FORCED_HEAD },
        committed(FORCED_HEAD, 'fix: rewritten root'),
      ],
      { openedHead: openingHead },
    );
    const commitsByOid = new Map(
      historicalOids.map((oid, index) => [
        oid,
        {
          sha: oid,
          commit: { message: index === 0 ? g0Message() : `fix: historical ${index}` },
          parents: index === 0 ? [{ sha: OPENING_PARENT }] : [{ sha: historicalOids[index - 1] }],
          files: [],
        },
      ]),
    );
    let ancestryQueries = 0;
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        const endpoint = args.at(-1);
        if (endpoint === '/repos/woojubb/robota/commits') {
          ancestryQueries += 1;
          const page = Number(args.find((arg) => arg.startsWith('page='))?.slice(5));
          const descending = [...historicalOids].reverse();
          return response(
            descending.slice((page - 1) * 100, page * 100).map((oid) => commitsByOid.get(oid)),
          );
        }
        return base(command, args);
      },
    });

    expect(fetchEvidence({ number: 7 })).toMatchObject({
      firstHeadOid: openingHead,
      forcePushEdges: [{ before: segmentTip, after: FORCED_HEAD }],
    });
    expect(ancestryQueries).toBe(10);
  });

  it('accepts the documented timeline capacity of 1000 commits plus 100 force events', () => {
    const nodes = [
      ...Array.from({ length: 1_000 }, (_, index) => ({
        __typename: 'PullRequestCommit',
        commit: {
          oid: (index + 10).toString(16).padStart(40, '0'),
          message: `fix: timeline ${index}`,
          parents: { totalCount: 0, nodes: [] },
        },
      })),
      ...Array.from({ length: 100 }, (_, index) => ({
        __typename: 'HeadRefForcePushedEvent',
        createdAt: PR_CREATED_AT,
        beforeCommit: { oid: (index + 2_000).toString(16).padStart(40, '0') },
        afterCommit: { oid: (index + 3_000).toString(16).padStart(40, '0') },
      })),
    ];
    let page = 0;
    const timeline = pullRequestTimeline('woojubb/robota', 7, () => {
      const pageNodes = nodes.slice(page * 100, (page + 1) * 100);
      page += 1;
      return {
        data: {
          repository: {
            pullRequest: {
              timelineItems: {
                nodes: pageNodes,
                pageInfo: {
                  hasNextPage: page * 100 < nodes.length,
                  endCursor: page * 100 < nodes.length ? `cursor-${page}` : null,
                },
              },
            },
          },
        },
      };
    });

    expect(timeline).toHaveLength(1_100);
    expect(page).toBe(11);
  });

  it('fails closed when the GitHub request fails', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: () => ({ status: 1, stdout: '', stderr: 'offline' }),
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/query failed/u);
  });

  it('fails closed on missing, edited, or late opening-head comments', () => {
    const timeline = [committed(INITIAL_HEAD, g0Message())];
    const cases = [
      [],
      [openingComment(INITIAL_HEAD, { updated_at: '2026-08-30T00:00:01Z' })],
      [
        openingComment(INITIAL_HEAD, {
          created_at: PR_CREATED_AT,
          updated_at: PR_CREATED_AT,
        }),
      ],
      [
        openingComment(INITIAL_HEAD, {
          created_at: '2026-08-30T00:00:01Z',
          updated_at: '2026-08-30T00:00:01Z',
        }),
      ],
      [openingComment(), openingComment(INITIAL_HEAD, { id: 12 })],
    ];
    for (const comments of cases) {
      const base = evidenceRunner(timeline, { currentHead: INITIAL_HEAD });
      const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
        run: (command, args) =>
          args.at(-1).includes('/comments?') ? response(comments) : base(command, args),
      });
      expect(() => fetchEvidence({ number: 7 })).toThrow(/missing|edited|late|duplicate/u);
    }
  });

  it('fails closed instead of reusing duplicate opening-head comments', () => {
    const comments = [openingComment(), openingComment(INITIAL_HEAD, { id: 12 })];

    expect(() =>
      createOpeningHeadComment(
        repository(),
        'woojubb/robota',
        {
          runId: 'run-1',
          headOid: INITIAL_HEAD,
        },
        {
          run: () => response(comments),
        },
      ),
    ).toThrow(/duplicate/u);
  });

  it('fails closed when the remote opening head is not a receipt-only closure', () => {
    const base = evidenceRunner([committed(INITIAL_HEAD, g0Message())], {
      currentHead: INITIAL_HEAD,
    });
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        const endpoint = args.at(-1);
        if (!endpoint.endsWith(`/commits/${INITIAL_HEAD}`)) return base(command, args);
        return response({
          sha: INITIAL_HEAD,
          parents: [{ sha: OPENING_PARENT }],
          files: [
            {
              filename: '.agents/evals/work-runs/run-1/g0-r0.json',
              status: 'added',
              sha: RECEIPT_BLOB,
            },
            { filename: 'forged.txt', status: 'added', sha: 'b'.repeat(40) },
          ],
        });
      },
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/receipt-only closure/u);
  });

  it('fails closed when the remote opening closure commit trailers are ambiguous', () => {
    const base = evidenceRunner([committed(INITIAL_HEAD, g0Message())], {
      currentHead: INITIAL_HEAD,
    });
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        const endpoint = args.at(-1);
        if (!endpoint.endsWith(`/commits/${INITIAL_HEAD}`)) return base(command, args);
        return response({
          sha: INITIAL_HEAD,
          commit: { message: `${g0Message()}\nWork-Run: forged-run` },
          parents: [{ sha: OPENING_PARENT }],
          files: [
            {
              filename: '.agents/evals/work-runs/run-1/g0-r0.json',
              status: 'added',
              sha: RECEIPT_BLOB,
            },
          ],
        });
      },
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/exactly one Work-Run/u);
  });

  it('fails closed when committed timeline history has no g0 receipt', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner([committed(CURRENT_HEAD, 'feat: no receipt')]),
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/comment is missing|ambiguous/u);
  });

  it('fails closed when bounded timeline pagination is truncated', () => {
    const fullPage = Array.from({ length: 100 }, (_, index) =>
      committed(index.toString(16).padStart(40, '0'), 'fix: page item'),
    );
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: evidenceRunner(fullPage),
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/exceeds the evidence budget/u);
  });

  it('fails closed when the shared GitHub request budget is exhausted', () => {
    expect(() =>
      attestedOpeningHead(
        repository(),
        'woojubb/robota',
        PR_CREATED_AT,
        { runId: 'run-1', headOid: INITIAL_HEAD },
        {
          run: () => response([]),
          budget: { remaining: 0, deadline: Date.now() + 1_000 },
        },
      ),
    ).toThrow(/budget exhausted/u);
  });

  it('fails closed on malformed GraphQL force-push OIDs', () => {
    const fetchEvidence = createPullRequestEvidenceFetcher(repository(), {
      run: (command, args) => {
        if (!args.includes('graphql')) return successfulRunner(command, args);
        return evidenceRunner([
          committed(INITIAL_HEAD, g0Message()),
          { event: 'head_ref_force_pushed', before: null, after: NORMAL_HEAD },
        ])(command, args);
      },
    });

    expect(() => fetchEvidence({ number: 7 })).toThrow(/force-push timeline evidence is invalid/u);
  });

  it('includes closed PR history and fails closed when a branch maps to multiple PRs', () => {
    const root = repository();
    const closed = resolvePullRequestHistoryContext(root, 'codex/work', {
      run: (_command, args) => {
        expect(args).toContain('state=all');
        return response([{ number: 7, state: 'closed', created_at: '2026-08-30T00:00:00Z' }]);
      },
    });
    expect(closed).toEqual({
      status: 'closed',
      number: 7,
      createdAt: '2026-08-30T00:00:00Z',
    });

    expect(
      resolvePullRequestHistoryContext(root, 'codex/work', {
        run: () =>
          response([
            { number: 7, state: 'closed' },
            { number: 8, state: 'open' },
          ]),
      }),
    ).toEqual({ status: 'unavailable', reason: 'github-pr-history-ambiguous' });
  });

  it('treats an authoritative empty all-state PR history as no PR', () => {
    expect(
      resolvePullRequestHistoryContext(repository(), 'codex/work', {
        run: () => response([]),
      }),
    ).toEqual({ status: 'none' });
  });
});
