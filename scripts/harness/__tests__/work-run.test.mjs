// harness-coverage: work-run-cli.mjs
// harness-coverage: work-run-cutover.mjs
// harness-coverage: work-run-domain.mjs
// harness-coverage: work-run-git.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { exactWorkRunReceiptTrailers } from '../work-run-commit-trailers.mjs';
import {
  applyWorkRunTrailers,
  assertReadyWorkingTreeClean,
  authorizePostPrReopen,
  buildCutoverMarker,
  openPullRequestNumber,
  prepareReopenRequest,
  parsePostFindingsAuthorization,
  resolveWorkRunSubject,
  terminalizeWorkRun,
  topicChangeDigestFromCompareFiles,
  writeImmutableWorkRunReceipt,
} from '../work-run.mjs';
import { repoContext } from '../work-run-git.mjs';

describe('work-run command helpers', () => {
  it('bounds every repository-context git command under one 15 second deadline', () => {
    const timeouts = [];
    const run = vi.fn((_command, args, options) => {
      timeouts.push(options.timeout);
      if (args.includes('--show-toplevel')) return '/repo\n';
      if (args.includes('symbolic-ref')) return 'codex/work\n';
      return '/repo/.git\n';
    });
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(5_000)
      .mockReturnValueOnce(14_900);

    expect(repoContext('/repo', { run, now })).toEqual({
      root: '/repo',
      branch: 'codex/work',
      commonDir: '/repo/.git',
    });
    expect(timeouts).toEqual([10_000, 10_000, 100]);
  });

  it('fails repository context distinctly on deadline and command timeout', () => {
    const run = vi.fn(() => '/repo\n');
    const deadlineNow = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(16);
    expect(() =>
      repoContext('/repo', { run, now: deadlineNow, totalCommandTimeoutMs: 15 }),
    ).toThrow(/git command deadline exceeded before symbolic-ref/i);

    expect(() =>
      repoContext('/repo', {
        run: () => {
          throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        },
      }),
    ).toThrow(/git command timed out during rev-parse/i);
  });

  it('adds one exact correlation pair and no-ops on the same pair', () => {
    const input = 'feat: add measurement\n';
    const first = applyWorkRunTrailers(input, {
      runId: 'run-1',
      receipt: 'g0-r0',
      source: 'message',
    });
    expect(first).toContain('Work-Run: run-1');
    expect(first).toContain('Work-Receipt: g0-r0');
    expect(
      applyWorkRunTrailers(first, { runId: 'run-1', receipt: 'g0-r0', source: 'message' }),
    ).toBe(first);
  });

  it('refuses partial/conflicting trailers and rewrite sources without an exact pair', () => {
    expect(() =>
      applyWorkRunTrailers('fix: x\n\nWork-Run: run-1\n', {
        runId: 'run-1',
        receipt: 'g0-r0',
        source: 'message',
      }),
    ).toThrow(/partial/i);
    expect(() =>
      applyWorkRunTrailers('fix: x\n', { runId: 'run-1', receipt: 'g0-r0', source: 'commit' }),
    ).toThrow(/preserve/i);
    expect(() =>
      applyWorkRunTrailers('fix: x\n\nWork-Run: other\nWork-Receipt: g0-r0\n', {
        runId: 'run-1',
        receipt: 'g0-r0',
        source: 'message',
      }),
    ).toThrow(/conflicting/i);
  });

  it('accepts one pair only from the terminal Git trailer block', () => {
    expect(
      exactWorkRunReceiptTrailers(
        'feat: measured\n\nWork-Run: run-1\nWork-Receipt: g0-r0\nSigned-off-by: Test <test@example.com>\n',
      ),
    ).toEqual({ runId: 'run-1', receiptId: 'g0-r0' });

    expect(() =>
      exactWorkRunReceiptTrailers(
        'Work-Run: body-run\n\nBody text.\n\nWork-Run: run-1\nWork-Receipt: g0-r0\n',
      ),
    ).toThrow(/terminal Git trailer block/i);
    expect(() =>
      exactWorkRunReceiptTrailers(
        'feat: measured\n\nWork-Run: run-1\nWork-Receipt: g0-r0\n\ntrailing prose\n',
      ),
    ).toThrow(/terminal Git trailer block/i);
    expect(() =>
      applyWorkRunTrailers('Work-Run: body-run\n\nBody text.\n', {
        runId: 'run-1',
        receipt: 'g0-r0',
        source: 'message',
      }),
    ).toThrow(/terminal Git trailer block/i);
  });

  it('builds a complete deterministic cutover registry', () => {
    expect(
      buildCutoverMarker({
        repository: 'woojubb/robota',
        openPullRequests: [
          {
            number: 9,
            createdAt: '2026-08-30T00:00:00Z',
            baseOid: 'b',
            headOid: 'h',
            identity: { headCommit: 'h' },
          },
          {
            number: 2,
            createdAt: '2026-08-29T00:00:00Z',
            baseOid: 'c',
            headOid: 'd',
            identity: { headCommit: 'd' },
          },
        ],
      }).openPullRequests.map((pr) => pr.number),
    ).toEqual([2, 9]);
  });

  it('builds a deterministic topic-change digest from bounded GitHub compare files', () => {
    const trees = {
      baseEntries: [
        { path: 'deleted.txt', mode: '100644', type: 'blob', sha: 'd'.repeat(40) },
        { path: 'old.txt', mode: '100644', type: 'blob', sha: 'e'.repeat(40) },
      ],
      headEntries: [
        { path: 'added.txt', mode: '100644', type: 'blob', sha: 'a'.repeat(40) },
        { path: 'renamed.txt', mode: '100644', type: 'blob', sha: 'b'.repeat(40) },
      ],
    };
    const digest = topicChangeDigestFromCompareFiles(
      [
        {
          filename: 'renamed.txt',
          previous_filename: 'old.txt',
          sha: 'b'.repeat(40),
          status: 'renamed',
        },
        { filename: 'deleted.txt', sha: 'c'.repeat(40), status: 'removed' },
        { filename: 'added.txt', sha: 'a'.repeat(40), status: 'added' },
      ],
      trees,
    );

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(
      topicChangeDigestFromCompareFiles(
        [
          { filename: 'added.txt', sha: 'a'.repeat(40), status: 'added' },
          { filename: 'deleted.txt', sha: 'c'.repeat(40), status: 'removed' },
          {
            filename: 'renamed.txt',
            previous_filename: 'old.txt',
            sha: 'b'.repeat(40),
            status: 'renamed',
          },
        ],
        trees,
      ),
    ).toBe(digest);
    expect(() =>
      topicChangeDigestFromCompareFiles(
        Array.from({ length: 300 }, (_, index) => ({
          filename: `file-${index}.txt`,
          sha: 'a'.repeat(40),
          status: 'added',
        })),
        { baseEntries: [], headEntries: [] },
      ),
    ).toThrow(/compare file budget/i);
  });

  it('binds the base blob and both file modes into a GitHub topic-change digest', () => {
    const finalOid = 'b'.repeat(40);
    const files = [{ filename: 'script.sh', sha: finalOid, status: 'modified' }];
    const digest = ({ oldOid, oldMode, newMode }) =>
      topicChangeDigestFromCompareFiles(files, {
        baseEntries: [{ path: 'script.sh', mode: oldMode, type: 'blob', sha: oldOid }],
        headEntries: [{ path: 'script.sh', mode: newMode, type: 'blob', sha: finalOid }],
      });

    const original = digest({ oldOid: 'a'.repeat(40), oldMode: '100644', newMode: '100755' });
    expect(digest({ oldOid: 'c'.repeat(40), oldMode: '100644', newMode: '100755' })).not.toBe(
      original,
    );
    expect(digest({ oldOid: 'a'.repeat(40), oldMode: '100644', newMode: '100644' })).not.toBe(
      original,
    );
  });

  it('distinguishes an authoritative no-open-PR result from an unavailable query', () => {
    const query = (result) =>
      openPullRequestNumber('/tmp/repository', 'codex/work', {
        repository: 'woojubb/robota',
        run: () => result,
      });

    expect(query({ status: 0, stdout: '[]' })).toEqual({ status: 'none' });
    expect(
      query({ status: 0, stdout: '[{"number":2514,"created_at":"2026-08-30T00:00:00Z"}]' }),
    ).toEqual({ status: 'open', number: 2514, createdAt: '2026-08-30T00:00:00Z' });
    expect(query({ status: 1, stdout: '', stderr: 'network unavailable' })).toEqual({
      status: 'unavailable',
      reason: 'github-open-pr-query-failed',
    });
  });

  it('shares the repository lookup and GitHub PR query deadline', () => {
    const gitTimeouts = [];
    const ghTimeouts = [];
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(14_900);
    const result = openPullRequestNumber('/tmp/repository', 'codex/work', {
      now,
      runGit: (_command, _args, options) => {
        gitTimeouts.push(options.timeout);
        return 'git@github.com:woojubb/robota.git\n';
      },
      run: (_command, _args, options) => {
        ghTimeouts.push(options.timeout);
        return { status: 0, stdout: '[]' };
      },
    });

    expect(result).toEqual({ status: 'none' });
    expect(gitTimeouts).toEqual([10_000]);
    expect(ghTimeouts).toEqual([100]);
  });

  it('parses the shared approved post-findings projection', () => {
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
    expect(parsePostFindingsAuthorization(body)).toEqual({
      prNumber: 42,
      head,
      verdict: 0,
      action: 'push',
      ground: 'red-check',
      evidence: 'https://example.test/check',
      scope: 'scripts/harness',
      approvedBy: '@maintainer',
    });
  });

  it('binds a structured authorization envelope to every post-PR reopen argument', () => {
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
    const rawAuthorization = JSON.stringify({
      id: 7,
      url: 'https://github.com/woojubb/robota/issues/42#issuecomment-7',
      author: { login: 'maintainer', association: 'MEMBER' },
      body,
    });
    const expected = {
      rawAuthorization,
      prNumber: '42',
      head,
      verdict: '0',
      action: 'push',
      ground: 'red-check',
    };

    expect(authorizePostPrReopen(expected)).toMatchObject({
      prNumber: 42,
      head,
      verdict: 0,
      action: 'push',
      ground: 'red-check',
      commentId: 7,
      commentAuthor: 'maintainer',
    });

    for (const mismatch of [
      { prNumber: '43' },
      { head: 'b'.repeat(40) },
      { verdict: '1' },
      { action: 'rebase' },
      { ground: 'finding' },
    ]) {
      expect(() => authorizePostPrReopen({ ...expected, ...mismatch })).toThrow(
        /matching approved/i,
      );
    }
  });

  it('requires a clean tree while permitting only the exact receipt closure flow', () => {
    const receipt = '.agents/evals/work-runs/run-1/g0-r0.json';

    expect(() => assertReadyWorkingTreeClean('', null)).not.toThrow();
    expect(() => assertReadyWorkingTreeClean(' M package.json', null)).toThrow(
      /clean working tree/i,
    );
    expect(() => assertReadyWorkingTreeClean(`?? ${receipt}`, receipt)).not.toThrow();
    expect(() => assertReadyWorkingTreeClean(`A  ${receipt}`, receipt)).not.toThrow();

    for (const status of [
      ` M ${receipt}`,
      `AM ${receipt}`,
      `?? ${receipt}.bak`,
      `?? ${receipt}\n M package.json`,
    ]) {
      expect(() => assertReadyWorkingTreeClean(status, receipt)).toThrow(/clean working tree/i);
    }
  });

  it('permits only generation-free local-fix reopening before the first PR', () => {
    expect(
      prepareReopenRequest({
        state: { generation: 0 },
        runId: 'run-1',
        at: '2026-08-30T01:00:00.000Z',
        ground: 'local-fix',
      }),
    ).toEqual({
      runId: 'run-1',
      at: '2026-08-30T01:00:00.000Z',
      ground: 'local-fix',
      generation: null,
    });

    for (const input of [
      { generation: '0' },
      { generation: '1' },
      { authorizationFile: '/tmp/auth.json' },
      { state: { generation: 1 } },
    ]) {
      expect(() =>
        prepareReopenRequest({
          state: { generation: 0 },
          runId: 'run-1',
          at: '2026-08-30T01:00:00.000Z',
          ground: 'local-fix',
          ...input,
        }),
      ).toThrow(/local-fix|pre-PR/i);
    }
    expect(() =>
      prepareReopenRequest({
        state: { generation: 0 },
        runId: 'run-1',
        at: '2026-08-30T01:00:00.000Z',
        ground: 'local-fix',
        currentPrNumber: 42,
      }),
    ).toThrow(/after PR #42/i);
    expect(() =>
      prepareReopenRequest({
        state: { generation: 0 },
        runId: 'run-1',
        at: '2026-08-30T01:00:00.000Z',
        ground: 'local-fix',
        currentPrContext: { status: 'unavailable', reason: 'network' },
      }),
    ).toThrow(/cannot prove that no open PR exists/i);
  });

  it('requires the exact next generation and complete structured authorization after PR', () => {
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
    const rawAuthorization = JSON.stringify({
      id: 7,
      url: 'https://github.com/woojubb/robota/issues/42#issuecomment-7',
      author: { login: 'maintainer', association: 'MEMBER' },
      body,
    });
    const required = {
      state: { generation: 0 },
      runId: 'run-1',
      at: '2026-08-30T01:00:00.000Z',
      ground: 'red-check',
      generation: '1',
      authorizationFile: '/tmp/auth.json',
      rawAuthorization,
      prNumber: '42',
      head,
      verdict: '0',
      action: 'push',
    };

    expect(prepareReopenRequest(required)).toMatchObject({
      runId: 'run-1',
      generation: 1,
      ground: 'red-check',
      authorization: { prNumber: 42, head, ground: 'red-check' },
    });

    for (const input of [
      { generation: undefined },
      { generation: '-1' },
      { generation: '0' },
      { generation: '2' },
      { authorizationFile: undefined },
      { prNumber: undefined },
      { head: undefined },
      { verdict: undefined },
      { action: undefined },
    ]) {
      expect(() => prepareReopenRequest({ ...required, ...input })).toThrow(
        /generation|authorization|requires/i,
      );
    }
  });

  it('reopens an existing post-PR generation only as an authorized receipt revision', () => {
    const head = 'c'.repeat(40);
    const body = `POST_FINDINGS_ACTION_REQUEST
PR: 42
HEAD: ${head}
VERDICT: 0
ACTION: push
GROUND: finding
EVIDENCE: https://example.test/finding
SCOPE: scripts/harness
APPROVED: yes
APPROVED-BY: @maintainer`;
    const rawAuthorization = JSON.stringify({
      id: 8,
      url: 'https://github.com/woojubb/robota/issues/42#issuecomment-8',
      author: { login: 'maintainer', association: 'MEMBER' },
      body,
    });
    const authorization = authorizePostPrReopen({
      rawAuthorization,
      prNumber: '42',
      head,
      verdict: '0',
      action: 'push',
      ground: 'finding',
    });
    const required = {
      state: {
        generation: 2,
        generationGround: 'finding',
        generationAuthorization: authorization,
      },
      runId: 'run-1',
      at: '2026-08-30T02:00:00.000Z',
      ground: 'finding',
      generation: '2',
      authorizationFile: '/tmp/auth.json',
      rawAuthorization,
      prNumber: '42',
      head,
      verdict: '0',
      action: 'push',
    };

    expect(prepareReopenRequest(required)).toEqual({
      runId: 'run-1',
      at: '2026-08-30T02:00:00.000Z',
      ground: 'finding',
      generation: null,
      authorization,
    });
    expect(() => prepareReopenRequest({ ...required, ground: 'red-check' })).toThrow(
      /same authorization and ground/i,
    );
    expect(() =>
      prepareReopenRequest({
        ...required,
        state: {
          ...required.state,
          generationAuthorization: { ...authorization, verdict: 1 },
        },
      }),
    ).toThrow(/same authorization and ground/i);
  });

  it('creates cutover receipts immutably, no-ops identically, and rejects conflicts', () => {
    const root = makeTemp('robota-work-run-cutover-receipt-');
    const receiptPath = path.join(root, 'nested', 'g0-r0.json');
    const receipt = { schemaVersion: 1, runId: 'pre-cutover-pr-42', generation: 0, revision: 0 };

    writeImmutableWorkRunReceipt(receiptPath, receipt);
    const original = readFileSync(receiptPath, 'utf8');
    expect(JSON.parse(original)).toEqual(receipt);
    expect(() => writeImmutableWorkRunReceipt(receiptPath, receipt)).not.toThrow();
    expect(() => writeImmutableWorkRunReceipt(receiptPath, { ...receipt, revision: 1 })).toThrow(
      /immutable work-run receipt conflict/i,
    );
    expect(readFileSync(receiptPath, 'utf8')).toBe(original);
  });

  it('terminalizes abandon locally and creates exclusions through the immutable receipt API', () => {
    const calls = [];
    const store = {
      append: (...args) => {
        calls.push(['append', ...args]);
        return { status: 'abandoned' };
      },
      exclude: (args) => {
        calls.push(['exclude', args]);
        return { receiptPath: '/receipt.json' };
      },
    };
    const common = {
      store,
      runId: 'run-1',
      at: '2026-08-30T01:00:00.000Z',
      reason: 'planning-only',
      identity: { branch: 'codex/topic', headCommit: 'a'.repeat(40) },
    };

    expect(
      terminalizeWorkRun({ ...common, command: 'abandon', workingTreeStatus: ' M x' }),
    ).toEqual({
      status: 'abandoned',
    });
    expect(calls[0]).toEqual([
      'append',
      'run-1',
      {
        type: 'work.abandoned',
        at: '2026-08-30T01:00:00.000Z',
        data: { reason: 'planning-only' },
      },
    ]);

    expect(terminalizeWorkRun({ ...common, command: 'exclude', workingTreeStatus: '' })).toEqual({
      receiptPath: '/receipt.json',
    });
    expect(calls[1]).toEqual([
      'exclude',
      {
        runId: 'run-1',
        at: '2026-08-30T01:00:00.000Z',
        reason: 'planning-only',
        identity: common.identity,
      },
    ]);
    expect(() =>
      terminalizeWorkRun({ ...common, command: 'exclude', workingTreeStatus: ' M package.json' }),
    ).toThrow(/clean working tree/i);
  });

  it('routes identity to an explicit or event-derived PR subject instead of a merge checkout', () => {
    const explicit = resolveWorkRunSubject({
      argv: ['ready', '--subject-sha', 'a'.repeat(40), '--subject-branch', 'codex/topic'],
      currentBranch: null,
      env: {},
    });
    expect(explicit).toEqual({ headRef: 'a'.repeat(40), branch: 'codex/topic' });

    const event = JSON.stringify({
      pull_request: { head: { sha: 'b'.repeat(40), ref: 'codex/from-event' } },
    });
    expect(
      resolveWorkRunSubject({
        argv: ['ready'],
        currentBranch: null,
        env: { GITHUB_EVENT_PATH: '/tmp/event.json', GITHUB_HEAD_REF: 'ignored' },
        readEvent: () => event,
      }),
    ).toEqual({ headRef: 'b'.repeat(40), branch: 'codex/from-event' });

    expect(() =>
      resolveWorkRunSubject({
        argv: ['ready', '--subject-sha', 'a'.repeat(40)],
        currentBranch: 'codex/topic',
        env: {},
      }),
    ).toThrow(/subject-sha.*subject-branch/i);
  });
});
// harness-coverage: work-run-git-command.mjs
// harness-coverage: work-run-git-context.mjs
