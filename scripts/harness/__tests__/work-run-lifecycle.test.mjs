import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import { main as runWorkRun } from '../work-run-cli.mjs';
import { currentIdentity, repoContext } from '../work-run-git.mjs';
import { WorkRunStore } from '../work-run-store.mjs';
import * as workRunFacade from '../work-run.mjs';

vi.setConfig({ testTimeout: 30_000 });

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const workRunCli = path.join(workspaceRoot, 'scripts/harness/work-run.mjs');
const reportCli = path.join(workspaceRoot, 'scripts/harness/work-run-report.mjs');
const scanCli = path.join(workspaceRoot, 'scripts/harness/scan-work-run-measurement.mjs');
const contractSource = path.join(workspaceRoot, 'scripts/harness/work-run-contract.mjs');
const branch = 'codex/work-run-lifecycle';
const baseRef = 'origin/develop';
const cleanGitHubEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_')),
);

let seedRoot;
let ghBin;

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
  }).trim();
}

function write(root, relative, text) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
  return file;
}

function commit(root, subject, { paths = ['-A'], runId = null, receipt = null } = {}) {
  if (paths.length === 1 && paths[0] === '-A') git(root, 'add', '-A');
  else git(root, 'add', '--', ...paths);
  const trailers = runId === null ? '' : `\n\nWork-Run: ${runId}\nWork-Receipt: ${receipt}`;
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-m', `${subject}${trailers}`);
  return git(root, 'rev-parse', 'HEAD');
}

function fixture() {
  const root = realpathSync(makeTemp('robota-work-run-lifecycle-'));
  cpSync(seedRoot, root, { recursive: true });
  git(root, 'config', 'user.name', 'Work Run Test');
  git(root, 'config', 'user.email', 'work-run@example.test');
  git(root, 'config', 'core.hooksPath', '.git/no-hooks');
  git(root, 'switch', '--quiet', '-c', branch);
  return { root, baseCommit: git(root, 'rev-parse', baseRef) };
}

function subjectArgs(root) {
  return ['--subject-sha', git(root, 'rev-parse', 'HEAD'), '--subject-branch', branch];
}

async function runNode(script, args, { root, github = null } = {}) {
  const env = { ...cleanGitHubEnv };
  env.PATH = `${ghBin}${path.delimiter}${env.PATH ?? ''}`;
  env.GH_FIXTURE = JSON.stringify(github ?? {});
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  return { stdout, stderr };
}

async function work(root, command, ...args) {
  return runWorkRun([command, '--root', root, ...args, ...subjectArgs(root)]);
}

async function workAt(root, at, command, ...args) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
  try {
    return runWorkRun([command, '--root', root, ...args, ...subjectArgs(root)]);
  } finally {
    vi.useRealTimers();
  }
}

function receiptRelative(runId, generation, revision) {
  return `.agents/evals/work-runs/${runId}/g${generation}-r${revision}.json`;
}

function authorization(messages, { ground, action, head, generation }) {
  const file = path.join(messages, `${ground}-${generation}.json`);
  const commentId = 2_514 + generation;
  writeFileSync(
    file,
    `${JSON.stringify({
      id: commentId,
      url: `https://github.com/woojubb/robota/pull/2514#issuecomment-${commentId}`,
      author: { login: 'maintainer', association: 'MEMBER' },
      body: `POST_FINDINGS_ACTION_REQUEST\nPR: 2514\nHEAD: ${head}\nVERDICT: ${generation}\nACTION: ${action}\nGROUND: ${ground}\nEVIDENCE: https://github.com/woojubb/robota/actions/runs/${generation}\nSCOPE: scripts/harness\nAPPROVED: yes\nAPPROVED-BY: @maintainer`,
    })}\n`,
    'utf8',
  );
  return file;
}

function githubComment(authorization) {
  return {
    id: authorization.commentId,
    node_id: `IC_${authorization.commentId}`,
    html_url: authorization.commentUrl,
    user: { login: authorization.commentAuthor },
    author_association: authorization.commentAuthorAssociation,
    created_at: '1999-12-31T23:59:59.000Z',
    updated_at: '1999-12-31T23:59:59.000Z',
    body: `POST_FINDINGS_ACTION_REQUEST\nPR: ${authorization.prNumber}\nHEAD: ${authorization.head}\nVERDICT: ${authorization.verdict}\nACTION: ${authorization.action}\nGROUND: ${authorization.ground}\nEVIDENCE: ${authorization.evidence}\nSCOPE: ${authorization.scope}\nAPPROVED: yes\nAPPROVED-BY: ${authorization.approvedBy}`,
  };
}

async function reopenAuthorized(root, messages, runId, generation, ground, action, at) {
  const reviewedHead = git(root, 'rev-parse', 'HEAD');
  const authorizationFile = authorization(messages, {
    ground,
    action,
    head: reviewedHead,
    generation,
  });
  if (action === 'rebase') {
    git(root, 'switch', '--quiet', 'develop');
    write(root, 'base/rebase.txt', `base for generation ${generation}\n`);
    commit(root, `chore: advance base for generation ${generation}`, {
      paths: ['base/rebase.txt'],
    });
    git(root, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(root, 'switch', '--quiet', branch);
    git(root, 'rebase', baseRef);
  }
  await workAt(
    root,
    at,
    'reopen',
    '--ground',
    ground,
    '--generation',
    String(generation),
    '--authorization-file',
    authorizationFile,
    '--pr',
    '2514',
    '--head',
    reviewedHead,
    '--verdict',
    String(generation),
    '--action',
    action,
  );
  let readyHead;
  if (action === 'rebase') {
    git(
      root,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      `chore: bind rebased generation\n\nWork-Run: ${runId}\nWork-Receipt: g${generation}-r0`,
    );
    readyHead = git(root, 'rev-parse', 'HEAD');
  } else {
    write(root, 'src/value.txt', `${ground} generation ${generation}\n`);
    readyHead = commit(root, `fix: ${ground} generation`, {
      paths: ['src/value.txt'],
      runId,
      receipt: `g${generation}-r0`,
    });
  }
  const ready = await workAt(
    root,
    new Date(Date.parse(at) + 1_000).toISOString(),
    'ready',
    '--base',
    baseRef,
  );
  const receiptPath = receiptRelative(runId, generation, 0);
  const closure = commit(root, `chore: close ${ground} generation`, {
    paths: [receiptPath],
    runId,
    receipt: `g${generation}-r0`,
  });
  expect(ready.receipt).toMatchObject({
    generation,
    revision: 0,
    ground,
    identity: { headCommit: readyHead, branch },
    authorization: { ground, action, head: reviewedHead },
  });
  return { readyHead, closure, authorization: ready.receipt.authorization };
}

beforeAll(() => {
  seedRoot = realpathSync(makeTemp('robota-work-run-seed-'));
  git(seedRoot, 'init', '--quiet', '-b', 'develop');
  git(seedRoot, 'config', 'user.name', 'Work Run Seed');
  git(seedRoot, 'config', 'user.email', 'seed@example.test');
  git(seedRoot, 'config', 'core.hooksPath', '.git/no-hooks');
  git(seedRoot, 'remote', 'add', 'origin', 'https://github.com/woojubb/robota.git');
  write(seedRoot, '.gitignore', '.agents/evals/local-metrics/\n');
  write(seedRoot, 'src/value.txt', 'base\n');
  write(seedRoot, 'scripts/mode.sh', '#!/bin/sh\nexit 0\n');
  write(seedRoot, 'scripts/harness/work-run-contract.mjs', readFileSync(contractSource, 'utf8'));
  write(
    seedRoot,
    '.agents/evals/work-runs/cutover-v1.json',
    `${JSON.stringify({
      schemaVersion: 1,
      markerId: 'work-run-v1',
      generatedAt: '2026-08-30T00:00:00.000Z',
      repository: 'woojubb/robota',
      openPullRequests: [],
    })}\n`,
  );
  commit(seedRoot, 'chore: seed repository');
  git(seedRoot, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');

  ghBin = realpathSync(makeTemp('robota-work-run-gh-'));
  const gh = write(
    ghBin,
    'gh',
    `#!/usr/bin/env node
const fixture = JSON.parse(process.env.GH_FIXTURE ?? '{}');
const args = process.argv.slice(2).join(' ');
let output;
if (args.includes('/search/issues')) output = [{ total_count: fixture.pullRequest ? 1 : 0, incomplete_results: false, items: fixture.pullRequest ? [{ number: fixture.pullRequest.number }] : [] }];
else if (args.includes('graphql') && args.includes('comments(first: 100')) {
  output = { data: { repository: { pullRequest: { comments: {
    nodes: Object.values(fixture.comments ?? {}).map((comment) => ({
      databaseId: comment.id,
      url: comment.html_url,
      body: comment.body,
      authorAssociation: comment.author_association,
      createdAt: comment.created_at,
      lastEditedAt: null,
      author: { login: comment.user?.login },
    })),
    pageInfo: { hasNextPage: false, endCursor: null }
  } } } } };
}
else if (args.includes('graphql') && args.includes('nodeId=')) {
  const comment = Object.values(fixture.comments ?? {}).find((candidate) => args.includes('nodeId=' + candidate.node_id));
  output = { data: { node: { __typename: 'IssueComment', databaseId: comment?.id, lastEditedAt: null } } };
}
else if (args.includes('graphql')) output = { data: { repository: { pullRequest: { timelineItems: {
  nodes: (fixture.timeline ?? []).map((event) => event.event === 'committed'
    ? { __typename: 'PullRequestCommit', commit: { oid: event.sha, message: event.message, parents: { totalCount: event.parents.length, nodes: event.parents.map((parent) => ({ oid: parent.sha })) } } }
    : { __typename: 'HeadRefForcePushedEvent', createdAt: '2026-08-30T00:00:01.000Z', beforeCommit: { oid: event.before_commit?.sha }, afterCommit: { oid: event.after_commit?.sha } }),
  pageInfo: { hasNextPage: false, endCursor: null }
} } } } };
else if (args.includes('/commits?')) output = [fixture.commits ?? []];
else if (args.includes('/commits/') && args.includes('/comments?')) {
  const comments = fixture.openingComments?.[args.match(/\\/commits\\/([^/]+)\\/comments\\?/)?.[1]] ?? [];
  output = args.includes('--slurp') ? [comments] : comments;
}
else if (args.includes('/contents/')) output = fixture.openingContent;
else if (args.includes('/commits/')) output = fixture.openingCommits?.[args.split('/').at(-1)];
else if (args.includes('/compare/')) output = fixture.compare;
else if (args.includes('/git/trees/')) output = fixture.trees?.[args.match(/\\/git\\/trees\\/([^?]+)/)?.[1]];
else if (args.includes('/issues/comments/')) output = fixture.comments?.[args.split('/').at(-1)];
else if (args.includes('/timeline?')) output = fixture.timeline ?? [];
else if (args.includes('head=') && args.includes('/pulls')) output = fixture.branchPullRequests ?? [];
else if (args.includes('/pulls/')) output = fixture.pullRequest;
else if (args.includes('pulls?state=open')) output = [fixture.openPullRequests ?? []];
else { process.stderr.write('unexpected gh arguments: ' + args); process.exit(2); }
process.stdout.write(JSON.stringify(output));
`,
  );
  chmodSync(gh, 0o755);
});

describe('work-run command lifecycle', () => {
  it('rejects production CLI timestamp backdating without creating a work run', async () => {
    const { root } = fixture();

    await expect(
      runNode(
        workRunCli,
        ['claim', '--root', root, '--at', '2000-01-01T00:00:00.000Z', ...subjectArgs(root)],
        { root },
      ),
    ).rejects.toThrow(/--at/i);

    expect(existsSync(path.join(root, '.agents/evals/local-metrics/work-runs'))).toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T00:00:00.000Z'));
    try {
      const claimed = runWorkRun(['claim', '--root', root, ...subjectArgs(root)], {
        now: () => '2000-01-01T00:00:00.000Z',
      });
      expect(claimed.events[0].at).toBe('2026-08-31T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
    expect(workRunFacade).not.toHaveProperty('main');
  });

  it('requires an explicit claim before trailers or lifecycle commands', () => {
    const { root } = fixture();
    const messageFile = write(root, 'commit-message.txt', 'feat: unmeasured\n');
    const context = repoContext(root);
    const store = new WorkRunStore({ root, gitCommonDir: context.commonDir });

    expect(() =>
      runWorkRun(['trailers', '--root', root, '--message-file', messageFile, ...subjectArgs(root)]),
    ).toThrow(/active work run.*claim/i);
    expect(() => runWorkRun(['start', '--root', root, ...subjectArgs(root)])).toThrow(
      /active work run.*claim/i,
    );
    expect(existsSync(store.pointerPath(branch))).toBe(false);
    expect(readFileSync(messageFile, 'utf8')).toBe('feat: unmeasured\n');
  });

  it.each([
    { command: 'ready', reason: null },
    { command: 'exclude', reason: 'pure-planning-range' },
  ])('reconciles a pending $command receipt through the CLI dirty-tree gate', async (scenario) => {
    const { root } = fixture();
    const claimed = await workAt(root, '2000-01-01T00:00:00.000Z', 'claim');
    await workAt(
      root,
      '2000-01-01T00:00:01.000Z',
      'bind',
      '--work-id',
      'OBSERVABILITY-002',
      '--lane',
      'L2',
      '--kind',
      'observability',
    );
    if (scenario.command === 'ready') {
      await workAt(root, '2000-01-01T00:00:02.000Z', 'start');
    }
    write(root, 'src/retry.txt', `${scenario.command} retry\n`);
    commit(root, `test: prepare ${scenario.command} retry`, {
      paths: ['src/retry.txt'],
      runId: claimed.runId,
      receipt: 'g0-r0',
    });

    const context = repoContext(root);
    let failPersistence = true;
    const store = new WorkRunStore({
      root,
      gitCommonDir: context.commonDir,
      persistenceHooks: {
        afterReceiptPersist() {
          if (!failPersistence) return;
          failPersistence = false;
          throw new Error('injected state persistence failure');
        },
      },
    });
    const identity = currentIdentity(root, branch, baseRef, 'HEAD');
    const request = {
      runId: claimed.runId,
      identity,
      at: '2000-01-01T00:00:03.000Z',
      ...(scenario.reason === null ? {} : { reason: scenario.reason }),
    };
    expect(() => store[scenario.command](request)).toThrow(/state persistence failure/i);

    const retryArguments = [scenario.command, '--base', baseRef];
    if (scenario.reason !== null) retryArguments.push('--reason', scenario.reason);
    const recovered = await workAt(root, '2000-01-01T00:00:04.000Z', ...retryArguments);
    expect(recovered.receiptPath).toBe(store.receiptPath(claimed.runId, 0, 0));
    expect(readFileSync(recovered.receiptPath, 'utf8')).toBe(
      `${JSON.stringify(recovered.receipt, null, 2)}\n`,
    );
  });

  it('runs pause/resume, receipt closure, validation, PR join, finding, rebase, and report', async () => {
    const { root, baseCommit } = fixture();
    const messages = makeTemp('robota-work-run-auth-');
    const claimed = await workAt(root, '2000-01-01T00:00:00.000Z', 'claim');
    const runId = claimed.runId;
    await workAt(
      root,
      '2000-01-01T00:00:01.000Z',
      'bind',
      '--work-id',
      'OBSERVABILITY-002',
      '--lane',
      'L2',
      '--kind',
      'observability',
    );
    await workAt(root, '2000-01-01T00:00:02.000Z', 'start');
    await workAt(root, '2000-01-01T00:00:03.000Z', 'phase-start', '--phase', 'implementation');
    await workAt(root, '2000-01-01T00:00:04.000Z', 'pause', '--reason', 'external-wait');
    await workAt(root, '2000-01-01T00:00:06.000Z', 'resume');
    write(root, 'src/value.txt', 'initial implementation\n');
    const initialReadyHead = commit(root, 'feat: measured implementation', {
      paths: ['src/value.txt'],
      runId,
      receipt: 'g0-r0',
    });
    await workAt(root, '2000-01-01T00:00:08.000Z', 'phase-complete', '--phase', 'implementation');
    const initialReady = await workAt(root, '2000-01-01T00:00:09.000Z', 'ready', '--base', baseRef);
    const initialReceiptPath = receiptRelative(runId, 0, 0);
    const initialReceiptBytes = readFileSync(path.join(root, initialReceiptPath), 'utf8');
    const initialClosure = commit(root, 'chore: close initial work run', {
      paths: [initialReceiptPath],
      runId,
      receipt: 'g0-r0',
    });
    expect(initialReady.receipt).toMatchObject({
      identity: { baseCommit, headCommit: initialReadyHead, branch },
      durations: { wallMs: 9_000, activeMs: 7_000, pausedMs: 2_000 },
    });

    const finding = await reopenAuthorized(
      root,
      messages,
      runId,
      1,
      'finding',
      'push',
      '2000-01-01T00:00:10.000Z',
    );
    const rebase = await reopenAuthorized(
      root,
      messages,
      runId,
      2,
      'rebase',
      'rebase',
      '2000-01-01T00:00:12.000Z',
    );
    expect(readFileSync(path.join(root, initialReceiptPath), 'utf8')).toBe(initialReceiptBytes);

    const timelineCommit = (sha) => ({
      event: 'committed',
      sha,
      message: git(root, 'show', '-s', '--format=%B', sha),
      parents: git(root, 'show', '-s', '--format=%P', sha)
        .split(' ')
        .filter(Boolean)
        .map((parent) => ({ sha: parent })),
    });
    const oldCommits = git(root, 'rev-list', '--reverse', `${baseCommit}..${finding.closure}`)
      .split('\n')
      .filter(Boolean);
    const currentCommits = git(root, 'rev-list', '--reverse', `${baseRef}..${rebase.closure}`)
      .split('\n')
      .filter(Boolean);
    const forceAfter = rebase.closure;
    const timeline = [
      ...oldCommits.map(timelineCommit),
      {
        event: 'head_ref_force_pushed',
        before_commit: { sha: finding.closure },
        after_commit: { sha: forceAfter },
      },
      ...currentCommits.filter((sha) => !oldCommits.includes(sha)).map(timelineCommit),
    ];
    const openingBody = `Work-Run-Opening-Head: v1\nWork-Run: ${runId}\nHead-Oid: ${initialClosure}`;
    const openingReceiptBytes = execFileSync(
      'git',
      ['show', `${initialClosure}:${initialReceiptPath}`],
      { cwd: root },
    );
    const openingBlob = git(root, 'rev-parse', `${initialClosure}:${initialReceiptPath}`);
    const scanGitHub = {
      pullRequest: {
        number: 2514,
        created_at: '2026-08-30T00:00:00.000Z',
        body: `Measured change\n\nWork-Run: ${runId}`,
        head: { sha: rebase.closure, ref: branch },
      },
      timeline,
      openingComments: {
        [initialClosure]: [
          {
            id: 1,
            commit_id: initialClosure,
            body: openingBody,
            created_at: '2026-08-29T23:59:59.000Z',
            updated_at: '2026-08-29T23:59:59.000Z',
          },
        ],
      },
      openingCommits: {
        [initialClosure]: {
          sha: initialClosure,
          commit: { message: git(root, 'show', '-s', '--format=%B', initialClosure) },
          parents: [{ sha: git(root, 'rev-parse', `${initialClosure}^`) }],
          files: [{ filename: initialReceiptPath, status: 'added', sha: openingBlob }],
        },
      },
      openingContent: {
        type: 'file',
        path: initialReceiptPath,
        sha: openingBlob,
        encoding: 'base64',
        content: openingReceiptBytes.toString('base64'),
      },
      comments: {
        [finding.authorization.commentId]: githubComment(finding.authorization),
        [rebase.authorization.commentId]: githubComment(rebase.authorization),
      },
    };

    const scan = await runNode(
      scanCli,
      [
        '--base',
        baseRef,
        '--subject-sha',
        rebase.closure,
        '--subject-branch',
        branch,
        '--pr',
        '2514',
      ],
      {
        root,
        github: scanGitHub,
      },
    );
    expect(scan.stdout).toContain('work-run-measurement: included');
    await expect(
      runNode(
        scanCli,
        [
          '--base',
          baseRef,
          '--subject-sha',
          rebase.closure,
          '--subject-branch',
          branch,
          '--pr',
          '2514',
        ],
        {
          root,
          github: {
            ...scanGitHub,
            timeline: timeline.map((event) =>
              event.event === 'head_ref_force_pushed'
                ? { ...event, after_commit: { sha: rebase.readyHead } }
                : event,
            ),
          },
        },
      ),
    ).rejects.toThrow(/post-pr-local-fix/);
    await expect(
      runNode(
        scanCli,
        [
          '--base',
          baseRef,
          '--subject-sha',
          rebase.closure,
          '--subject-branch',
          branch,
          '--pr',
          '2514',
        ],
        {
          root,
          github: {
            ...scanGitHub,
            comments: {
              [rebase.authorization.commentId]: githubComment(rebase.authorization),
            },
          },
        },
      ),
    ).rejects.toThrow(/authorization-comment-unverified/);

    const commits = git(root, 'rev-list', '--reverse', `${baseRef}..${rebase.closure}`)
      .split('\n')
      .filter(Boolean)
      .map((sha) => ({ sha, commit: { message: git(root, 'show', '-s', '--format=%B', sha) } }));
    const report = await runNode(reportCli, ['--root', root], {
      root,
      github: {
        pullRequest: {
          number: 2514,
          body: `Work-Run: ${runId}`,
          base: { repo: { full_name: 'woojubb/robota' } },
          head: { sha: rebase.closure },
          created_at: '2026-08-30T00:00:00.000Z',
        },
        commits,
        timeline,
        openingComments: scanGitHub.openingComments,
        openingCommits: scanGitHub.openingCommits,
        openingContent: scanGitHub.openingContent,
      },
    });
    const projection = JSON.parse(report.stdout);
    expect(projection.populations).toMatchObject({ included: 3, superseded: 0 });
    expect(projection.unavailableReasons).toEqual({});
    expect(projection.firstPrRuns).toEqual([expect.objectContaining({ runId, prNumber: 2514 })]);
    expect(projection.reworkByGround).toMatchObject({
      finding: { count: 1 },
      rebase: { count: 1 },
    });
    expect([initialClosure, finding.closure, rebase.closure]).toHaveLength(3);
  });

  it('accepts an explicit pure-planning documentation exclusion through scan and report', async () => {
    const { root } = fixture();
    const claimed = await workAt(root, '2000-01-01T00:00:00.000Z', 'claim');
    const runId = claimed.runId;
    await workAt(
      root,
      '2000-01-01T00:00:01.000Z',
      'bind',
      '--work-id',
      'DOCS-001',
      '--lane',
      'L1',
      '--kind',
      'docs',
    );
    const basename = 'DOCS-001-planning-only.md';
    write(
      root,
      `.agents/tasks/${basename}`,
      '---\nstatus: todo\n---\n\n# DOCS-001 planning task\n',
    );
    write(
      root,
      `.agents/spec-docs/draft/${basename}`,
      '---\nstatus: draft\ntype: DOCS\n---\n\n# DOCS-001 planning spec\n',
    );
    commit(root, 'docs: record planning-only work', {
      paths: [`.agents/tasks/${basename}`, `.agents/spec-docs/draft/${basename}`],
      runId,
      receipt: 'g0-r0',
    });
    const excluded = await workAt(
      root,
      '2000-01-01T00:00:02.000Z',
      'exclude',
      '--reason',
      'pure-planning-range',
      '--base',
      baseRef,
    );
    const receiptPath = receiptRelative(runId, 0, 0);
    const closure = commit(root, 'chore: close planning exclusion', {
      paths: [receiptPath],
      runId,
      receipt: 'g0-r0',
    });
    expect(excluded.receipt).toMatchObject({
      disposition: 'excluded',
      reason: 'pure-planning-range',
      cohort: { key: 'L1/docs' },
    });

    const scan = await runNode(
      scanCli,
      ['--base', baseRef, '--subject-sha', closure, '--subject-branch', branch],
      { root },
    );
    expect(scan.stdout).toContain('work-run-measurement: excluded');
    const report = JSON.parse((await runNode(reportCli, ['--root', root], { root })).stdout);
    expect(report.populations).toMatchObject({ excluded: 1, included: 0 });
  });

  it('permits exact state-lost recovery while reporting it as invalid', async () => {
    const { root } = fixture();
    const runId = 'lost-run';
    write(root, 'src/value.txt', 'surviving work after local state loss\n');
    commit(root, 'feat: surviving work', {
      paths: ['src/value.txt'],
      runId,
      receipt: 'g0-r0',
    });
    const recovered = await work(
      root,
      'recover',
      '--state-lost',
      '--run-id',
      runId,
      '--base',
      baseRef,
    );
    const receiptPath = receiptRelative(runId, 0, 0);
    const closure = commit(root, 'chore: close state-lost recovery', {
      paths: [receiptPath],
      runId,
      receipt: 'g0-r0',
    });
    expect(recovered.receipt).toMatchObject({
      disposition: 'invalid',
      reason: 'state-lost',
      timestamps: { claimedAt: null, readyAt: null },
    });

    const scan = await runNode(
      scanCli,
      ['--base', baseRef, '--subject-sha', closure, '--subject-branch', branch],
      { root },
    );
    expect(scan.stdout).toContain('work-run-measurement: invalid');
    const report = JSON.parse((await runNode(reportCli, ['--root', root], { root })).stdout);
    expect(report.populations).toMatchObject({ invalid: 1, excluded: 0 });
    expect(report.invalidReasons).toEqual({ 'state-lost': 1 });
  });

  it('plans the server-observed cutover registry and seals its registered old PR', async () => {
    const controller = fixture();
    const target = fixture();
    write(target.root, 'src/value.txt', 'old pull request head\n');
    chmodSync(path.join(target.root, 'scripts/mode.sh'), 0o755);
    const targetHead = commit(target.root, 'feat: old pull request', {
      paths: ['src/value.txt', 'scripts/mode.sh'],
    });
    const baseTreeOid = git(target.root, 'rev-parse', `${target.baseCommit}^{tree}`);
    const headTreeOid = git(target.root, 'rev-parse', `${targetHead}^{tree}`);
    const github = {
      openPullRequests: [
        {
          number: 7,
          created_at: '2026-08-29T00:00:00.000Z',
          base: { sha: target.baseCommit },
          head: { sha: targetHead, ref: branch },
        },
      ],
      commits: [
        {
          sha: targetHead,
          commit: {
            message: git(target.root, 'show', '-s', '--format=%B', targetHead),
            tree: { sha: git(target.root, 'rev-parse', `${targetHead}^{tree}`) },
          },
        },
      ],
      compare: {
        base_commit: { sha: target.baseCommit, commit: { tree: { sha: baseTreeOid } } },
        commits: [{ sha: targetHead }],
        files: [
          {
            filename: 'src/value.txt',
            sha: git(target.root, 'rev-parse', `${targetHead}:src/value.txt`),
            status: 'modified',
          },
          {
            filename: 'scripts/mode.sh',
            sha: git(target.root, 'rev-parse', `${targetHead}:scripts/mode.sh`),
            status: 'modified',
          },
        ],
      },
      trees: {
        [baseTreeOid]: {
          truncated: false,
          tree: [
            {
              path: 'src/value.txt',
              mode: '100644',
              type: 'blob',
              sha: git(target.root, 'rev-parse', `${target.baseCommit}:src/value.txt`),
            },
            {
              path: 'scripts/mode.sh',
              mode: '100644',
              type: 'blob',
              sha: git(target.root, 'rev-parse', `${target.baseCommit}:scripts/mode.sh`),
            },
          ],
        },
        [headTreeOid]: {
          truncated: false,
          tree: [
            {
              path: 'src/value.txt',
              mode: '100644',
              type: 'blob',
              sha: git(target.root, 'rev-parse', `${targetHead}:src/value.txt`),
            },
            {
              path: 'scripts/mode.sh',
              mode: '100755',
              type: 'blob',
              sha: git(target.root, 'rev-parse', `${targetHead}:scripts/mode.sh`),
            },
          ],
        },
      },
    };
    const planned = await runNode(
      workRunCli,
      [
        'cutover-plan',
        '--root',
        controller.root,
        '--repo',
        'woojubb/robota',
        ...subjectArgs(controller.root),
      ],
      { root: controller.root, github },
    );
    expect(JSON.parse(planned.stdout)).toMatchObject({ status: 'planned', count: 1 });

    const sealed = await runNode(
      workRunCli,
      [
        'cutover-seal',
        '--root',
        controller.root,
        '--target-worktree',
        target.root,
        '--pr',
        '7',
        ...subjectArgs(controller.root),
      ],
      { root: controller.root },
    );
    const result = JSON.parse(sealed.stdout);
    const receiptBytes = readFileSync(result.receiptPath, 'utf8');
    const receipt = JSON.parse(receiptBytes);
    expect(receipt).toMatchObject({
      disposition: 'pre-cutover',
      reason: 'registered-open-pr',
      prNumber: 7,
      identity: {
        repository: 'woojubb/robota',
        baseCommit: target.baseCommit,
        headCommit: targetHead,
        changeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });

    const receiptPath = path.relative(target.root, result.receiptPath);
    commit(target.root, 'chore: seal pre-cutover work run', {
      paths: [receiptPath],
      runId: 'pre-cutover-pr-7',
      receipt: 'g0-r0',
    });
    git(target.root, 'switch', '--quiet', 'develop');
    write(
      target.root,
      '.agents/evals/work-runs/cutover-v1.json',
      readFileSync(path.join(controller.root, '.agents/evals/work-runs/cutover-v1.json'), 'utf8'),
    );
    write(target.root, 'base/cutover.txt', 'base advanced after cutover\n');
    commit(target.root, 'chore: publish cutover marker');
    git(target.root, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(target.root, 'switch', '--quiet', branch);
    git(target.root, 'rebase', baseRef);

    const exactClosure = git(target.root, 'rev-parse', 'HEAD');
    git(target.root, 'reflog', 'expire', '--expire=now', '--all');
    git(target.root, 'gc', '--prune=now');
    expect(() => git(target.root, 'cat-file', '-e', `${targetHead}^{commit}`)).toThrow();

    const exactScan = await runNode(
      scanCli,
      ['--base', baseRef, '--subject-sha', exactClosure, '--subject-branch', branch, '--pr', '7'],
      { root: target.root },
    );
    expect(exactScan.stdout).toContain('work-run-measurement: excluded');

    git(target.root, 'switch', '--quiet', 'develop');
    write(target.root, 'src/value.txt', 'new base-side content\n');
    commit(target.root, 'chore: change the topic file on the new base', {
      paths: ['src/value.txt'],
    });
    git(target.root, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(target.root, 'switch', '--quiet', branch);
    expect(() => git(target.root, 'rebase', baseRef)).toThrow();
    write(target.root, 'src/value.txt', 'old pull request head\n');
    git(target.root, 'add', '--', 'src/value.txt');
    git(target.root, '-c', 'core.editor=true', 'rebase', '--continue');
    const baseChangedClosure = git(target.root, 'rev-parse', 'HEAD');

    await expect(
      runNode(
        scanCli,
        [
          '--base',
          baseRef,
          '--subject-sha',
          baseChangedClosure,
          '--subject-branch',
          branch,
          '--pr',
          '7',
        ],
        { root: target.root },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('altered-pre-cutover-topic-change'),
    });
  });
});
