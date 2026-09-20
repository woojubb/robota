import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { isReviewed, recordPathFor } from '../record-local-review.mjs';
import { runPostVerdictGuard } from '../pre-push-local-checks.mjs';
import { dispatchedAgents } from '../scan-orchestration-map.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/pre-push-check.sh');
const SKILL = path.join(WORKSPACE_ROOT, '.agents/skills/pr-finding-resolution-loop/SKILL.md');

/**
 * The review round happens BEFORE the push, and something makes it happen.
 *
 * `pr-finding-resolution-loop` used to wait for required checks to go green before its first review round, so
 * the reviewer only ever saw a diff that had already been pushed, opened as a PR and run through CI. Every
 * finding therefore cost a push → CI round trip before anyone could look at it. Measured across one session
 * (2026-07-28), PRs #1514/#1518/#1519/#1520/#1521: 38 rounds, 24 carrying a blocking finding, at 6–10 minutes
 * of CI each — and not one of those findings needed CI to be seen.
 *
 * Writing that into the skill is not enough; a rule with no mechanism is the defect this repository spent the
 * same session removing from four hooks. So the assertions below cover both halves: the gate refuses an
 * unreviewed push, and the skill still says where the round belongs.
 */
const scratch = [];
const seedRepos = new Map();
const initialHeadShas = new Map();

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function seedRepo(branch) {
  const cached = seedRepos.get(branch);
  if (cached) return cached;

  const dir = makeTemp('review-gate-seed-');
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  const seed = { dir, headSha: git('rev-parse', 'HEAD').stdout.trim() };
  seedRepos.set(branch, seed);
  return seed;
}

function scratchRepo(branch) {
  const seed = seedRepo(branch);
  const dir = makeTemp('review-gate-');
  scratch.push(dir);
  cpSync(seed.dir, dir, { recursive: true });
  initialHeadShas.set(dir, seed.headSha);
  return dir;
}

function initialHeadSha(dir) {
  const sha = initialHeadShas.get(dir);
  if (!sha) throw new Error(`No cached initial HEAD for fixture: ${dir}`);
  return sha;
}

function record(dir, branch, sha, findings = 0) {
  const file = recordPathFor(branch, path.join(dir, '.agents/local-reviews'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ branch, headSha: sha, findings }));
}

// Every push gets the stub, and the default is "no open pull request" — the world every case here
// was written for. Left to the real `gh` on PATH, a case would ask GitHub over the network for a
// branch that exists only in a temp directory: slow, one API call per case, and answered differently
// depending on whether the machine running the suite happens to be authenticated or has `GH_REPO`
// set. A case's verdict must come from what it set up, not from the environment it ran in.
function push(dir, command = 'git push -u origin feat/probe', { openPrs = 0 } = {}) {
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: dir,
    PATH: `${stubGh(openPrs)}${path.delimiter}${process.env.PATH}`,
  };

  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }),
    encoding: 'utf8',
    env,
    timeout: 120_000,
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function bridgePush(dir, declaredBase) {
  return runPostVerdictGuard({
    cwd: dir,
    script: HOOK,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: dir,
      HARNESS_BASE_REF: declaredBase,
      PATH: `${stubGh(0)}${path.delimiter}${process.env.PATH}`,
    },
  });
}

function trustedIntegrationRepo({
  agreementId = 'AGREEMENT-2664',
  taskStatus = 'in-progress',
  specStatus = 'in-progress',
  taskBody = '',
  specBody = '',
} = {}) {
  const remote = makeTemp('review-gate-remote-');
  const dir = makeTemp('review-gate-integration-');
  scratch.push(remote, dir);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
    }
    return result.stdout.trim();
  };
  const commit = (file, body, message) => {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
    git('add', file);
    git('commit', '--quiet', '-m', message);
  };

  spawnSync('git', ['init', '--quiet', '--bare', remote], { encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=develop');
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  commit('pnpm-lock.yaml', 'lockfileVersion: 9\n', 'chore: root');
  git('remote', 'add', 'origin', remote);
  git('push', '--quiet', '-u', 'origin', 'develop');
  git('push', '--quiet', 'origin', 'develop:main');

  const agreementSlug = agreementId.toLowerCase();
  const integrationBranch = `integration/${agreementSlug}`;
  git('checkout', '--quiet', '-b', integrationBranch, 'origin/develop');
  commit(
    `.agents/tasks/${agreementId}-fixture.md`,
    `---\nstatus: ${taskStatus}\n---\n# ${agreementId}\n${taskBody}`,
    `docs: add ${agreementId} task`,
  );
  commit(
    `.agents/spec-docs/active/${agreementId}-fixture.md`,
    `---\nstatus: ${specStatus}\ntype: AGREEMENT\ntags: [harness]\n---\n# ${agreementId}\n${specBody}`,
    `docs: add ${agreementId} spec`,
  );

  git('checkout', '--quiet', '-b', 'fixture/completed-child');
  commit('completed-child.txt', 'complete\n', 'feat: complete prior child');
  git('checkout', '--quiet', integrationBranch);
  git('merge', '--quiet', '--no-ff', 'fixture/completed-child', '-m', 'merge: completed child');
  git('push', '--quiet', '-u', 'origin', integrationBranch);
  const integrationHead = git('rev-parse', 'HEAD');

  git('checkout', '--quiet', '-b', 'fix/stacked-child');
  commit('stacked-child.txt', 'next\n', 'fix: next stacked child');
  record(dir, 'fix/stacked-child', git('rev-parse', 'HEAD'));

  return { dir, git, commit, remote, integrationBranch, integrationHead };
}

function trustedIntegrationSyncRepo({ variant = 'clean' } = {}) {
  const fixture = trustedIntegrationRepo();
  if (variant === 'conflict-tree') {
    fixture.git('checkout', '--quiet', fixture.integrationBranch);
    fixture.commit('sync-conflict.txt', 'integration\n', 'feat: integration side of sync conflict');
    fixture.git('push', '--quiet', 'origin', fixture.integrationBranch);
    fixture.integrationHead = fixture.git('rev-parse', 'HEAD');
    fixture.git('checkout', '--quiet', '-b', 'fixture/develop-ahead', 'origin/develop');
    fixture.commit('sync-conflict.txt', 'develop\n', 'feat: develop side of sync conflict');
    fixture.git('push', '--quiet', 'origin', 'HEAD:develop');
    fixture.git('fetch', '--quiet', 'origin');
    fixture.git('checkout', '--quiet', fixture.integrationBranch);
    const mergeTree = spawnSync(
      'git',
      ['-C', fixture.dir, 'merge-tree', '--write-tree', 'HEAD', 'origin/develop'],
      { encoding: 'utf8' },
    );
    if (mergeTree.status === 0)
      throw new Error('conflict-tree fixture unexpectedly merged cleanly');
    const tree = mergeTree.stdout.split('\n')[0].trim();
    const conflictCommit = fixture.git(
      'commit-tree',
      tree,
      '-p',
      fixture.integrationHead,
      '-p',
      fixture.git('rev-parse', 'origin/develop'),
      '-m',
      'merge: persist conflict-marker tree',
    );
    fixture.git('update-ref', `refs/heads/${fixture.integrationBranch}`, conflictCommit);
    fixture.git('read-tree', '--reset', '-u', conflictCommit);
    record(fixture.dir, fixture.integrationBranch, conflictCommit);
    return fixture;
  }
  fixture.git('checkout', '--quiet', '-b', 'fixture/develop-ahead', 'origin/develop');
  fixture.commit('develop-change.txt', 'develop\n', 'feat: advance develop');
  fixture.git('push', '--quiet', 'origin', 'HEAD:develop');
  fixture.git('fetch', '--quiet', 'origin');

  if (variant === 'reversed') {
    fixture.git('branch', '-f', fixture.integrationBranch, 'origin/develop');
    fixture.git('checkout', '--quiet', fixture.integrationBranch);
    fixture.git(
      'merge',
      '--quiet',
      '--no-ff',
      fixture.integrationHead,
      '-m',
      'merge: reversed sync',
    );
  } else {
    fixture.git('checkout', '--quiet', fixture.integrationBranch);
    fixture.git('merge', '--quiet', '--no-ff', 'origin/develop', '-m', 'merge: sync develop');
  }

  if (variant === 'stale') {
    fixture.git('checkout', '--quiet', 'fixture/develop-ahead');
    fixture.commit('later-develop-change.txt', 'later\n', 'feat: advance develop again');
    fixture.git('push', '--quiet', 'origin', 'HEAD:develop');
    fixture.git('fetch', '--quiet', 'origin');
    fixture.git('checkout', '--quiet', fixture.integrationBranch);
  } else if (variant === 'remote-stale') {
    const currentRemoteDevelop = fixture.git('rev-parse', 'origin/develop');
    const previousDevelop = fixture.git('rev-parse', 'origin/develop^');
    const remoteMove = spawnSync(
      'git',
      ['--git-dir', fixture.remote, 'update-ref', 'refs/heads/develop', previousDevelop],
      { encoding: 'utf8' },
    );
    if (remoteMove.status !== 0) {
      throw new Error(`${remoteMove.stdout}${remoteMove.stderr}`);
    }
    if (fixture.git('rev-parse', 'origin/develop') !== currentRemoteDevelop) {
      throw new Error('remote-stale fixture unexpectedly refreshed its local tracking ref');
    }
  } else if (variant === 'extra') {
    fixture.git('checkout', '--quiet', '-b', 'fixture/extra-after-sync');
    fixture.commit('extra-after-sync.txt', 'extra\n', 'feat: add extra sync work');
    fixture.git('checkout', '--quiet', fixture.integrationBranch);
    fixture.git(
      'merge',
      '--quiet',
      '--no-ff',
      'fixture/extra-after-sync',
      '-m',
      'merge: extra after sync',
    );
  } else if (variant === 'own-path') {
    writeFileSync(path.join(fixture.dir, 'own-resolution.txt'), 'not from either parent\n');
    fixture.git('add', 'own-resolution.txt');
    fixture.git('commit', '--quiet', '--amend', '--no-edit');
  }

  record(fixture.dir, fixture.integrationBranch, fixture.git('rev-parse', 'HEAD'));
  return fixture;
}

/**
 * A `gh` on PATH that answers the one question the hook asks it.
 *
 * `openPrs` is the number of open pull requests the branch heads. The hook asks
 * `gh pr list --head <branch> --state open --json number --jq '.[0].number // empty'`, so the stub
 * prints a pull-request NUMBER when there is one and nothing when there is none — the shape real
 * `gh` prints after applying that jq. `''` makes it exit non-zero instead — the
 * unauthenticated / offline / no-such-repository case, which reaches the same refusal as `gh` being
 * absent altogether, because `command -v gh` and the lookup sit in one condition and either half
 * failing leaves the demand in place.
 */
function stubGh(openPrs) {
  const dir = makeTemp('gh-stub-');
  scratch.push(dir);
  // It answers by ARGUMENTS, not by invocation count, so a case can tell the two lookups apart.
  // `pr list --head <branch>` gets the branch's open-pull-request count; a bare `pr view <thing>`
  // gets `OPEN`, which is what real gh returns when it reads the argument as a pull-request NUMBER.
  // A stub that printed one answer to every call would pass whichever lookup the hook used, and the
  // number-collision case below would assert nothing.
  const body =
    openPrs === ''
      ? '#!/bin/bash\nexit 1\n'
      : `#!/bin/bash
for arg in "$@"; do
  if [ "$arg" = "--head" ]; then ${
    Number(openPrs) > 0 ? `printf '%s\\n' '4242'` : 'printf ""'
  }; exit 0; fi
done
printf 'OPEN\\n'
`;
  const file = path.join(dir, 'gh');
  writeFileSync(file, body, { mode: 0o755 });
  return dir;
}

describe('a stacked child declares a trusted integration base', () => {
  it('routes a safe declaration through the real guard and rejects unsafe projection', () => {
    const fixture = trustedIntegrationRepo();

    expect(bridgePush(fixture.dir, 'origin/integration/agreement-2664')).toBe(true);
    expect(bridgePush(fixture.dir, 'origin/integration/agreement-404')).toBe(false);
    expect(bridgePush(fixture.dir, 'origin/integration/agreement-2664;#')).toBe(false);
  });

  it('allows a child whose foreign merges are contained by the matching remote AGREEMENT base', () => {
    const fixture = trustedIntegrationRepo();
    const verdict = push(
      fixture.dir,
      'HARNESS_BASE_REF=origin/integration/agreement-2664 git push origin fix/stacked-child',
    );

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('rejects quoted HARNESS_BASE_REF declarations', () => {
    const fixture = trustedIntegrationRepo();
    for (const command of [
      'HARNESS_BASE_REF="origin/integration/agreement-2664" git push origin fix/stacked-child',
      "'HARNESS_BASE_REF=origin/integration/agreement-2664' git push origin fix/stacked-child",
    ]) {
      const verdict = push(fixture.dir, command);
      expect(verdict.status, `${command}\n${verdict.output}`).toBe(2);
      expect(verdict.output).toMatch(/trusted integration base|each push statement/);
    }
  });

  it('requires exactly one declaration bound as a prefix of every content push statement', () => {
    const fixture = trustedIntegrationRepo();
    const base = 'HARNESS_BASE_REF=origin/integration/agreement-2664';
    for (const command of [
      `${base} ${base} git push origin fix/stacked-child`,
      `${base} date; git push origin fix/stacked-child`,
      `${base} date; ${base} git push origin fix/stacked-child`,
      `${base} git push origin fix/stacked-child && git push origin sibling`,
      `git push origin fix/stacked-child ${base}`,
    ]) {
      const verdict = push(fixture.dir, command);
      expect(verdict.status, `${command}\n${verdict.output}`).toBe(2);
      expect(verdict.output).toMatch(/each push statement/);
    }
  });

  it('requires the matching Task and spec to be open in frontmatter', () => {
    const fixture = trustedIntegrationRepo({
      taskStatus: 'done',
      specStatus: 'done',
      taskBody: 'status: in-progress\n',
      specBody: 'status: in-progress\ntype: AGREEMENT\n',
    });
    const verdict = push(
      fixture.dir,
      'HARNESS_BASE_REF=origin/integration/agreement-2664 git push origin fix/stacked-child',
    );

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/matching open AGREEMENT-2664 Task\/spec pair/);
  });

  it('preserves the ordinary foreign-merge refusal without a declaration', () => {
    const fixture = trustedIntegrationRepo();
    const verdict = push(fixture.dir, 'git push origin fix/stacked-child');

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/carries merge commits in its range over origin\/develop/);
  });

  it('rejects self-authorizing, main, local, and unresolved base aliases', () => {
    const fixture = trustedIntegrationRepo();
    for (const ref of [
      'HEAD',
      'fix/stacked-child',
      'main',
      'origin/main',
      'integration/agreement-2664',
      'origin/integration/missing',
      'origin/integration/agreement-404',
    ]) {
      const verdict = push(
        fixture.dir,
        `HARNESS_BASE_REF=${ref} git push origin fix/stacked-child`,
      );
      expect(verdict.status, `${ref}\n${verdict.output}`).toBe(2);
      expect(verdict.output).toMatch(/trusted integration base/);
    }
  });

  it('requires the remote ref identity to match its AGREEMENT pair', () => {
    const fixture = trustedIntegrationRepo();
    fixture.git(
      'push',
      '--quiet',
      'origin',
      `${fixture.integrationHead}:refs/heads/integration/agreement-999`,
    );
    fixture.git('fetch', '--quiet', 'origin');

    const verdict = push(
      fixture.dir,
      'HARNESS_BASE_REF=origin/integration/agreement-999 git push origin fix/stacked-child',
    );
    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/matching open AGREEMENT-999 Task\/spec pair/);
  });

  it('rejects a stale remote-tracking claim instead of trusting its local value', () => {
    const fixture = trustedIntegrationRepo();
    const remoteMove = spawnSync(
      'git',
      [
        '--git-dir',
        fixture.remote,
        'update-ref',
        `refs/heads/${fixture.integrationBranch}`,
        fixture.git('rev-parse', 'origin/develop'),
      ],
      { encoding: 'utf8' },
    );
    expect(remoteMove.status, `${remoteMove.stdout}${remoteMove.stderr}`).toBe(0);

    const verdict = push(
      fixture.dir,
      'HARNESS_BASE_REF=origin/integration/agreement-2664 git push origin fix/stacked-child',
    );
    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/current remote ref/);
  });

  it('rejects a main-derived remote integration alias even with a matching pair', () => {
    const fixture = trustedIntegrationRepo();
    fixture.git('checkout', '--quiet', '-b', 'fixture/main-ahead', 'origin/main');
    fixture.commit('main-only.txt', 'main\n', 'feat: advance main only');
    fixture.git('push', '--quiet', 'origin', 'HEAD:main');
    fixture.git('fetch', '--quiet', 'origin');
    fixture.git('checkout', '--quiet', '-b', 'fixture/main-integration', 'origin/main');
    fixture.git('checkout', fixture.integrationHead, '--', '.agents/tasks', '.agents/spec-docs');
    fixture.git('add', '.agents/tasks', '.agents/spec-docs');
    fixture.git('commit', '--quiet', '-m', 'docs: add matching agreement pair');
    fixture.git(
      'push',
      '--quiet',
      '--force',
      'origin',
      `HEAD:refs/heads/${fixture.integrationBranch}`,
    );
    fixture.git('fetch', '--quiet', 'origin');
    fixture.git('checkout', '--quiet', '-b', 'fix/main-derived-child');
    fixture.commit('main-derived-child.txt', 'child\n', 'fix: main-derived child');
    record(fixture.dir, 'fix/main-derived-child', fixture.git('rev-parse', 'HEAD'));

    const verdict = push(
      fixture.dir,
      'HARNESS_BASE_REF=origin/integration/agreement-2664 git push origin fix/main-derived-child',
    );
    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/main-derived/);
  });

  it('rejects a matching remote base that is not an ancestor of the child', () => {
    const fixture = trustedIntegrationRepo();
    fixture.git('checkout', '--quiet', '-b', 'fixture/unrelated-base', 'origin/develop');
    fixture.git('checkout', fixture.integrationHead, '--', '.agents/tasks', '.agents/spec-docs');
    fixture.git('add', '.agents/tasks', '.agents/spec-docs');
    fixture.git('commit', '--quiet', '-m', 'docs: add unrelated agreement pair');
    fixture.git(
      'push',
      '--quiet',
      '--force',
      'origin',
      `HEAD:refs/heads/${fixture.integrationBranch}`,
    );
    fixture.git('fetch', '--quiet', 'origin');
    fixture.git('checkout', '--quiet', 'fix/stacked-child');

    const verdict = push(
      fixture.dir,
      'HARNESS_BASE_REF=origin/integration/agreement-2664 git push origin fix/stacked-child',
    );
    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/not an ancestor/);
  });

  it('rejects a child merge that is not contained by the trusted base', () => {
    const fixture = trustedIntegrationRepo();
    fixture.git('checkout', '--quiet', '-b', 'fixture/uncontained-merge');
    fixture.commit('uncontained.txt', 'merge\n', 'fix: uncontained work');
    fixture.git('checkout', '--quiet', 'fix/stacked-child');
    fixture.git(
      'merge',
      '--quiet',
      '--no-ff',
      'fixture/uncontained-merge',
      '-m',
      'merge: uncontained work',
    );
    record(fixture.dir, 'fix/stacked-child', fixture.git('rev-parse', 'HEAD'));

    const verdict = push(
      fixture.dir,
      'HARNESS_BASE_REF=origin/integration/agreement-2664 git push origin fix/stacked-child',
    );
    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/not contained by trusted integration base/);
  });
});

describe('an integration base syncs current develop', () => {
  it('allows one clean HEAD merge with remote integration first and current develop second', () => {
    const fixture = trustedIntegrationSyncRepo();
    const verdict = push(
      fixture.dir,
      `HARNESS_BASE_REF=origin/${fixture.integrationBranch} git push origin ${fixture.integrationBranch}`,
    );

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('rejects reversed, stale, remote-stale, additional, own-path, and conflicted-tree sync variants', () => {
    for (const variant of [
      'reversed',
      'stale',
      'remote-stale',
      'extra',
      'own-path',
      'conflict-tree',
    ]) {
      const fixture = trustedIntegrationSyncRepo({ variant });
      const verdict = push(
        fixture.dir,
        `HARNESS_BASE_REF=origin/${fixture.integrationBranch} git push origin ${fixture.integrationBranch}`,
      );

      expect(verdict.status, `${variant}\n${verdict.output}`).toBe(2);
      expect(verdict.output).toMatch(/invalid integration-base sync|origin\/develop is stale/);
    }
  });
});

describe('a feature-branch push carries a reviewed diff', () => {
  it('refuses a push with no local review recorded', () => {
    const dir = scratchRepo('feat/probe');
    const verdict = push(dir);

    expect(
      verdict.status,
      'an unreviewed diff was pushed, which is where the CI trips come from',
    ).toBe(2);
    expect(verdict.output).toMatch(/no local review recorded/);
  });

  it('allows the push once the review at this commit is recorded', () => {
    const dir = scratchRepo('feat/probe');
    record(dir, 'feat/probe', initialHeadSha(dir));

    expect(push(dir).status).toBe(0);
  });

  it('refuses again once the diff changes', () => {
    // Keyed on the HEAD sha deliberately: a new commit is a new diff, and the previous round's review no
    // longer describes what would be sent. That property is the entire point.
    const dir = scratchRepo('feat/probe');
    record(dir, 'feat/probe', initialHeadSha(dir));
    writeFileSync(path.join(dir, 'more'), 'x\n');
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'feat: more'], { encoding: 'utf8' });

    const verdict = push(dir);
    expect(verdict.status, 'a review of an older commit was accepted for a newer diff').toBe(2);
    expect(verdict.output).toMatch(/the diff has changed since/);
  });

  it('refuses a record that matches the commit but reports open findings', () => {
    // The enforcement point is this hook, and it was checking the sha alone. `record-local-review`
    // refuses to WRITE such a record and its `isReviewed()` checks both — but the hook never calls
    // that function, so the duplicated logic had drifted from its own spec, and no test covered the
    // combination. Exactly the accidental-green gap: every existing case passed either way.
    const dir = scratchRepo('feat/probe');
    record(dir, 'feat/probe', initialHeadSha(dir), 3);

    const verdict = push(dir);
    expect(verdict.status, 'a record with open findings satisfied the gate').toBe(2);
    expect(verdict.output).toMatch(/3 finding\(s\) still open/);
  });

  it('refuses a record whose findings count is unreadable', () => {
    // Absent is not zero. A record missing the field cannot say the review was clean.
    const dir = scratchRepo('feat/probe');
    const file = recordPathFor('feat/probe', path.join(dir, '.agents/local-reviews'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ branch: 'feat/probe', headSha: initialHeadSha(dir) }));

    expect(push(dir).status, 'a record with no findings field passed as clean').toBe(2);
  });

  it('does not demand a review for a push that only deletes remote branches (issue #2310)', () => {
    // `post-merge-cycle` mandates `git push origin --delete <merged-branch>`, and this hook refused
    // it against the review record of whatever branch the checkout was parked on — "the diff has
    // changed since" — for a push that carries no diff. Every spelling of a deletion is exempt.
    const dir = scratchRepo('feat/probe');
    for (const command of [
      'git push origin --delete feat/old',
      'git push --delete origin feat/old',
      'git push -d origin feat/old',
      'git push origin :feat/old',
      'git push origin --delete feat/old && git push origin --delete feat/older',
    ]) {
      const verdict = push(dir, command);
      expect(verdict.status, `a deletion was refused: ${command}\n${verdict.output}`).toBe(0);
      expect(verdict.output).toMatch(/Deletion-only push/);
    }
  });

  it('still demands a review when a deletion is chained with a content push', () => {
    // The exemption is per statement. A content push beside a deletion carries a diff someone
    // should have reviewed, and a refspec WITH a local side (`HEAD:refs/heads/x`) is not a deletion.
    const dir = scratchRepo('feat/probe');
    for (const command of [
      'git push origin --delete feat/old && git push -u origin feat/probe',
      'git push origin HEAD:refs/heads/feat/probe',
    ]) {
      const verdict = push(dir, command);
      expect(verdict.status, `an unreviewed content push was waved: ${command}`).toBe(2);
      expect(verdict.output).toMatch(/no local review recorded/);
    }
  });

  it('refuses a push from a detached HEAD', () => {
    // No branch means no key for a record, and falling through produced one shared filename that
    // every detached push would satisfy for every other. The hygiene check above exempts the empty
    // case because it has nothing to compare; this one has something to protect and no key for it.
    const dir = scratchRepo('feat/probe');
    record(dir, 'feat/probe', initialHeadSha(dir));
    spawnSync('git', ['-C', dir, 'checkout', '--quiet', '--detach'], { encoding: 'utf8' });

    const verdict = push(dir, 'git push origin HEAD:refs/heads/feat/probe');
    expect(verdict.status, 'a detached-HEAD push skipped the gate').toBe(2);
    expect(verdict.output).toMatch(/detached HEAD/);
  });

  it('lets the advertised override work from a detached HEAD', () => {
    // The detached-HEAD refusal named an override that sat BELOW it, so following the instruction
    // changed nothing and the message pointed at a door that was not there. A guard that tells you
    // how to proceed and then refuses anyway is the kind that gets worked around.
    const dir = scratchRepo('feat/probe');
    spawnSync('git', ['-C', dir, 'checkout', '--quiet', '--detach'], { encoding: 'utf8' });
    const verdict = push(
      dir,
      'PRE_PUSH_ALLOW_UNREVIEWED=1 git push origin HEAD:refs/heads/feat/probe',
    );

    expect(verdict.status, 'the override the message advertises does not work').toBe(0);
  });

  it('honours an inline override and says the diff was unreviewed', () => {
    const dir = scratchRepo('feat/probe');
    const verdict = push(dir, 'PRE_PUSH_ALLOW_UNREVIEWED=1 git push -u origin feat/probe');

    expect(verdict.status).toBe(0);
    expect(verdict.output, 'an override that does not announce itself is a silent bypass').toMatch(
      /unreviewed diff/,
    );
  });

  it('does not let one override excuse a second, unprefixed push', () => {
    // `PRE_PUSH_ALLOW_UNREVIEWED=1 git push a && git push b` overrides the first push and not the
    // second in real shell semantics. Letting the whole command through grants an unearned bypass
    // to the second — the one direction this file never trades in.
    const dir = scratchRepo('feat/probe');
    const verdict = push(
      dir,
      'PRE_PUSH_ALLOW_UNREVIEWED=1 git push origin feat/probe && git push origin other',
    );

    expect(verdict.status, 'an unprefixed second push rode in on the first override').toBe(2);
  });

  it('still honours an override that prefixes every push', () => {
    const dir = scratchRepo('feat/probe');
    const verdict = push(
      dir,
      'PRE_PUSH_ALLOW_UNREVIEWED=1 git push origin a && PRE_PUSH_ALLOW_UNREVIEWED=1 git push origin b',
    );

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('ignores an override attached to some other statement', () => {
    // The override is a visible, deliberate choice about THIS push. Matched anywhere in the command,
    // `PRE_PUSH_ALLOW_UNREVIEWED=1 date; git push …` disarms the gate with an assignment that never
    // reaches the push. merge-gate already carries this correction; applying it there and not here
    // is the sibling asymmetry this session kept finding.
    const dir = scratchRepo('feat/probe');
    const verdict = push(dir, 'PRE_PUSH_ALLOW_UNREVIEWED=1 date; git push -u origin feat/probe');

    expect(verdict.status, 'an override bound to another statement disarmed the gate').toBe(2);
  });

  it('does not exempt a hotfix or an ordinary release branch', () => {
    // The exemption list here is deliberately narrower than the branch-hygiene one above it, which
    // answers a different question: that one asks whether comparing to develop means anything, this
    // one asks whether the push carries a diff someone should have reviewed. A hotfix carries
    // exactly that, and is the push least worth waving through.
    for (const branch of ['hotfix/urgent', 'release/1.2.0']) {
      const dir = scratchRepo(branch);
      expect(push(dir, `git push origin ${branch}`).status, branch).toBe(2);
    }
  });

  it('points a blocked push at the base its branch is built on', () => {
    // `release/*` and `hotfix/*` are based on main, per this file's own hygiene section, and are
    // deliberately not exempt from the gate — so naming develop unconditionally sent a blocked
    // hotfix to diff against the wrong base.
    const hotfix = scratchRepo('hotfix/urgent');
    expect(push(hotfix, 'git push origin hotfix/urgent').output).toMatch(/origin\/main\.\.\.HEAD/);

    const feature = scratchRepo('feat/probe');
    expect(push(feature).output).toMatch(/origin\/develop\.\.\.HEAD/);
  });

  it('stops demanding a local review once the pull request is open', () => {
    // HARNESS-074. Two reviewers is one too many. An OPEN pull request runs its own review on every
    // push and carries the history of the rounds before it; demanding a second, local, subjective
    // review before each of those pushes did not add a reviewer, it multiplied CI rounds — the loop
    // pushed once per local round, and every push bought another remote review of the same change.
    const dir = scratchRepo('feat/probe');
    const verdict = push(dir, 'git push origin feat/probe', { openPrs: 1 });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output, 'a waived demand that says nothing is a silent bypass').toMatch(
      /open pull request/i,
    );
  });

  it('still demands one before the pull request exists', () => {
    // The cost argument that put this gate here survives untouched for the first push: no pull
    // request means no reviewer has seen this diff, so the round belongs here, where it is free.
    // A merged or closed pull request counts as none — `--state open` is what the hook asks for, so
    // the branch's earlier, finished pull request must not go on waiving reviews of new work.
    const dir = scratchRepo('feat/probe');
    const verdict = push(dir, 'git push origin feat/probe', { openPrs: 0 });
    expect(verdict.status, verdict.output).toBe(2);
  });

  it('treats an unanswerable pull-request lookup as no pull request', () => {
    // Unknown is not open. Offline, unauthenticated, or with no `gh` at all, the gate gives the
    // refusal it gave before the exemption existed — an exemption that opens on a failed measurement
    // is the vacuous green this harness keeps finding.
    const dir = scratchRepo('feat/probe');
    expect(push(dir, 'git push origin feat/probe', { openPrs: '' }).status).toBe(2);
  });

  it('does not read a branch named like a number as that pull request', () => {
    // `gh pr view <branch>` decides between a number, a URL and a branch by shape, so a branch named
    // `42` is answered with pull request #42's state — a waiver granted on another change's
    // evidence. The lookup asks `--head`, which only ever means a branch, and the stub below answers
    // "no open pull request heads this branch" the way the real one would.
    const dir = scratchRepo('42');
    expect(push(dir, 'git push origin 42', { openPrs: 0 }).status).toBe(2);
  });

  it('exempts the integration branches and a promotion branch', () => {
    // A promotion carries develop's already-reviewed content and no diff of its own; requiring a review of
    // it would be a gate on nothing, and gates on nothing are what get overridden.
    for (const branch of ['develop', 'main', 'gh-pages', 'release/promote-develop-to-main']) {
      const dir = scratchRepo(branch);
      expect(push(dir, `git push origin ${branch}`).status, branch).toBe(0);
    }
  });
});

describe('a record only counts when it describes this commit and a clean review', () => {
  it('rejects a record for another commit, or one with open findings', () => {
    const dir = makeTemp('record-');
    scratch.push(dir);
    const store = path.join(dir, 'records');
    mkdirSync(store, { recursive: true });
    writeFileSync(
      recordPathFor('feat/x', store),
      JSON.stringify({ branch: 'feat/x', headSha: 'aaa', findings: 0 }),
    );

    expect(isReviewed('feat/x', 'aaa', store)).toBe(true);
    expect(isReviewed('feat/x', 'bbb', store), 'a stale record passed for a new commit').toBe(
      false,
    );

    writeFileSync(
      recordPathFor('feat/y', store),
      JSON.stringify({ branch: 'feat/y', headSha: 'aaa', findings: 2 }),
    );
    expect(isReviewed('feat/y', 'aaa', store), 'a review with open findings counted as clean').toBe(
      false,
    );
  });

  it('keeps two branches whose names once encoded alike apart', () => {
    // `feat/foo` and `feat__foo` both mapped to `feat__foo.json`, so one branch's review satisfied
    // the gate for the other, unreviewed one. The encoding is one-to-one now, and the stored branch
    // name is checked as well — a record that arrives at this path some other way is still not
    // this branch's review.
    const dir = makeTemp('record-collide-');
    scratch.push(dir);
    mkdirSync(dir, { recursive: true });

    expect(recordPathFor('feat/foo', dir)).not.toBe(recordPathFor('feat__foo', dir));

    writeFileSync(
      recordPathFor('feat/foo', dir),
      JSON.stringify({ branch: 'feat/foo', headSha: 'aaa', findings: 0 }),
    );
    expect(isReviewed('feat/foo', 'aaa', dir)).toBe(true);
    expect(
      isReviewed('feat__foo', 'aaa', dir),
      'a record for another branch satisfied this one',
    ).toBe(false);
  });

  it('treats an unreadable record as absent', () => {
    const dir = makeTemp('record-bad-');
    scratch.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(recordPathFor('feat/z', dir), 'not json');

    expect(isReviewed('feat/z', 'aaa', dir), 'a corrupt record passed as a review').toBe(false);
  });
});

describe('the recorder refuses to guess which checkout it is in', () => {
  const RECORDER = path.join(WORKSPACE_ROOT, 'scripts/harness/record-local-review.mjs');

  it('fails loudly outside a git work tree instead of using its own repository', () => {
    // The resolver caught a failed `rev-parse` and fell back to the script's own location — doing
    // precisely what its own docstring said must not happen: reading and writing one checkout's
    // records while judging another. A no-fallback violation, and the one place the bash side of
    // this gate refuses to guess while the JS side did.
    const outside = makeTemp('not-a-repo-');
    scratch.push(outside);

    const result = spawnSync('node', [RECORDER, '--show'], {
      cwd: outside,
      encoding: 'utf8',
    });

    expect(result.status, 'the recorder guessed a repository instead of refusing').not.toBe(0);
    expect(`${result.stderr}`, 'it refused without saying why').toMatch(
      /not inside a git work tree/,
    );
  });
});

describe('a foundational finding must name a root item that exists', () => {
  const RECORDER = path.join(WORKSPACE_ROOT, 'scripts/harness/record-local-review.mjs');

  function repoWithBacklog(items = []) {
    const dir = scratchRepo('feat/probe');
    mkdirSync(path.join(dir, '.agents/tasks'), { recursive: true });
    for (const id of items) {
      writeFileSync(
        path.join(dir, '.agents/tasks', `${id}-something.md`),
        '---\nstatus: todo\n---\n',
      );
    }
    return dir;
  }

  function recordIn(dir, args) {
    const result = spawnSync('node', [RECORDER, ...args], { cwd: dir, encoding: 'utf8' });
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('refuses an ID that resolves to no backlog item', () => {
    // The whole value of the depth verdict is that the root gets filed. An ID naming nothing is the
    // same as not having filed it — and it is worse than silence, because the record then claims a
    // root item exists. So the recorder refuses rather than storing an unresolvable promise.
    const dir = repoWithBacklog(['INFRA-073']);

    const verdict = recordIn(dir, ['--findings', '0', '--foundational', 'INFRA-999']);

    expect(verdict.status, 'an unfiled root item was accepted').not.toBe(0);
    expect(verdict.output).toMatch(/INFRA-999/);
  });

  it('records the IDs when they resolve, and stores them', () => {
    const dir = repoWithBacklog(['INFRA-073', 'PROC-004']);

    const verdict = recordIn(dir, [
      '--findings',
      '0',
      '--foundational',
      'INFRA-073,PROC-004',
      '--notes',
      'aggregation held',
    ]);

    expect(verdict.status, verdict.output).toBe(0);
    const stored = JSON.parse(
      readFileSync(recordPathFor('feat/probe', path.join(dir, '.agents/local-reviews')), 'utf8'),
    );
    expect(stored.foundational).toEqual(['INFRA-073', 'PROC-004']);
    expect(stored.notes, 'the note was silently dropped').toBe('aggregation held');
  });

  it('resolves an ID whose prefix has more than one segment', () => {
    // `.agents/tasks/` already holds `ARCH-AUDIT-001` and `HARNESS-DIET-006`. A pattern reading
    // one letter-group matched neither, so the floor would have refused a root item that exists —
    // turning a filed foundational finding into an unpushable branch, which is the failure mode
    // most likely to teach someone to stop using the flag.
    const dir = repoWithBacklog(['ARCH-AUDIT-001', 'HARNESS-DIET-006']);

    const verdict = recordIn(dir, ['--findings', '0', '--foundational', 'HARNESS-DIET-006']);

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('resolves an item filed without a description suffix', () => {
    // The pattern required a `-` after the number, so `INFRA-073.md` would have read as no item at
    // all. Nothing in the naming convention forbids that file name, and the failure mode is the one
    // this floor exists to prevent in reverse: refusing a root item that is right there.
    const dir = scratchRepo('feat/probe');
    mkdirSync(path.join(dir, '.agents/tasks'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/tasks', 'INFRA-073.md'), '---\nstatus: todo\n---\n');

    const result = spawnSync('node', [RECORDER, '--findings', '0', '--foundational', 'INFRA-073'], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(result.status ?? 1, `${result.stdout ?? ''}${result.stderr ?? ''}`).toBe(0);
  });

  it('keeps a phase suffix, which is part of the ID', () => {
    // `.agents/tasks/` already holds SELFHOST-003-P4, SELFHOST-008-P5 and SELFHOST-011-P3-P4.
    // Truncating at the first number does two wrong things at once: the real ID is refused, and a
    // TRUNCATED id that names no file is accepted as though it did. The repository already parses
    // this correctly in `check-backlog-placement`, so the pattern has one owner rather than two.
    const dir = scratchRepo('feat/probe');
    mkdirSync(path.join(dir, '.agents/tasks'), { recursive: true });
    writeFileSync(
      path.join(dir, '.agents/tasks', 'SELFHOST-008-P5-concrete-semantic-backend.md'),
      '---\nstatus: todo\n---\n',
    );

    const ok = spawnSync(
      'node',
      [RECORDER, '--findings', '0', '--foundational', 'SELFHOST-008-P5'],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(ok.status ?? 1, `${ok.stdout ?? ''}${ok.stderr ?? ''}`).toBe(0);

    const truncated = spawnSync(
      'node',
      [RECORDER, '--findings', '0', '--foundational', 'SELFHOST-008'],
      { cwd: dir, encoding: 'utf8' },
    );
    expect(truncated.status ?? 1, 'an ID naming no file was accepted').not.toBe(0);
  });

  it('refuses when the backlog tree it must read is not there', () => {
    // The sibling that owns `idOf` uses `requireGovernedTree` for exactly this: a governed tree that
    // is absent must not read as "no results". Here it would produce the most misleading message the
    // tool can emit — "no backlog item for X" — when the truth is that nothing was examined.
    const dir = scratchRepo('feat/probe');

    const verdict = spawnSync(
      'node',
      [RECORDER, '--findings', '0', '--foundational', 'INFRA-073'],
      {
        cwd: dir,
        encoding: 'utf8',
      },
    );

    expect(verdict.status ?? 1).not.toBe(0);
    expect(`${verdict.stdout ?? ''}${verdict.stderr ?? ''}`).toMatch(
      /missing|not examined|examined/i,
    );
  });

  it('refuses a flag it does not understand instead of ignoring it', () => {
    // `--note` (singular) was accepted by silence for as long as the recorder existed: the argument
    // parser skipped anything it did not recognise, so every note passed that way was dropped and
    // the record said nothing about it. A flag the tool ignores is a flag the caller believes in.
    const dir = repoWithBacklog([]);

    const verdict = recordIn(dir, ['--findings', '0', '--note', 'this was never stored']);

    expect(verdict.status, 'an unknown flag was silently ignored').not.toBe(0);
    expect(verdict.output).toMatch(/--note\b/);
  });
});

describe('the depth verdict is wired into the pipeline that must act on it', () => {
  // Anti-rot only, and it says so: these assert that the routing EXISTS, not that it fires. What
  // makes the rule reached is the recorder above, which refuses an unfiled root item on every push
  // — a check nothing can satisfy by describing itself. The repository's own measured failure is a
  // guard that was registered everywhere and reached nowhere, so the distinction is stated rather
  // than left for a reader to assume from a green suite.
  const read = (rel) => readFileSync(path.join(WORKSPACE_ROOT, rel), 'utf8');

  it('the fixer is told to stop on a foundational finding, not patch it', () => {
    const fixer = read('.claude/agents/pr-review-fixer.md');

    expect(fixer, 'the fixer never learns the depth question').toMatch(/FOUNDATIONAL/);
    expect(fixer, 'nothing tells it not to patch one').toMatch(/[Dd]o not patch/);
  });

  it('the orchestrator routes a foundational finding out of the fix loop', () => {
    const skill = read('.agents/skills/pr-finding-resolution-loop/SKILL.md');
    const roundA = skill.slice(skill.indexOf('### Round A'), skill.indexOf('### Round B'));

    expect(roundA, 'depth is not asked before the fix').toMatch(/FOUNDATIONAL/);
    expect(roundA, 'the recorded root item has no way in').toMatch(/--foundational/);
  });

  it('the rule and the guardian that judges for it are both registered', () => {
    expect(read('.agents/rules/index.md')).toMatch(/finding-depth\.md/);
    expect(read('.agents/skills/index.md')).toMatch(/finding-depth-triager/);
    expect(read('.agents/rules/finding-depth.md'), 'the rule names no enforcement point').toMatch(
      /record-local-review/,
    );
  });
});

describe('the skill still puts the round before the push', () => {
  const skill = readFileSync(SKILL, 'utf8');

  it('describes the local-diff round and the command that records it', () => {
    // The measured reason this changed, kept where the next reader of the skill will meet it.
    // The window narrowed with HARNESS-074 — the round is before the PULL REQUEST, not before every
    // push — so this pins the narrowed claim rather than the phrase it replaced.
    expect(skill).toMatch(/before the pull request exists/i);
    expect(skill).toMatch(/harness:review:record/);
  });

  it('never dispatches a reviewer on the open pull request', () => {
    // HARNESS-074's own test plan. Round B once dispatched `pr-review-reviewer` on the OPEN pull
    // request — a second review of what CI had already reviewed, without the comment history, so it
    // could not see which findings an earlier round had answered. Correcting the prose is not the
    // guard; this is, and it must not fire on the sentence in Round B that MENTIONS the agent while
    // describing what the local round does, which is why it reads dispatch language rather than the
    // name. `dispatchedAgents` is the same reading the orchestration map's own drift check uses.
    const roundB = skill.slice(skill.indexOf('### Round B'));

    expect(
      dispatchedAgents(roundB, [
        'pr-review-reviewer',
        'architecture-structure-auditor',
        'architecture-design-auditor',
        'architecture-runtime-auditor',
        'architecture-gate-auditor',
        'proposal-reviewer',
      ]),
      'the loop dispatches a reviewer on an open pull request, which is the duplication it exists to prevent',
    ).toEqual([]);
  });

  it('says the round stops once the pull request is open, as the hook does', () => {
    // Two statements of one gate drift; the hook waives its demand on an open PR, and a skill that
    // still called the round unconditional would send an agent to review what CI is already
    // reviewing — the duplication HARNESS-074 is about, re-created in the document that describes
    // the fix.
    const roundA = skill.slice(skill.indexOf('### Round A'), skill.indexOf('### Round B'));

    expect(roundA, 'the skill does not say where Round A stops').toMatch(
      /stops the moment one is open/i,
    );
  });

  it('keeps the CI-green precondition out of the first round', () => {
    // The precondition belongs to the merge round, which must judge what will actually merge. If it
    // drifts back to the top, every finding costs a CI cycle again — which is the state this replaced.
    const roundA = skill.slice(skill.indexOf('### Round A'), skill.indexOf('### Round B'));

    expect(
      roundA,
      'the pre-push round waits for CI again, which is the round trip this change removed',
    ).not.toMatch(/ci-gate-watch|required checks green/i);
  });
});
