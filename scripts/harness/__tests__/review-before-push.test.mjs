import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { isReviewed, recordPathFor } from '../record-local-review.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/pre-push-check.sh');
const SKILL = path.join(WORKSPACE_ROOT, '.agents/skills/pr-review-orchestration/SKILL.md');

/**
 * The review round happens BEFORE the push, and something makes it happen.
 *
 * `pr-review-orchestration` used to wait for required checks to go green before its first review round, so
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

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(branch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-gate-'));
  scratch.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

function headSha(dir) {
  return spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
}

function record(dir, branch, sha, findings = 0) {
  const file = recordPathFor(branch, path.join(dir, '.agents/local-reviews'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ branch, headSha: sha, findings }));
}

function push(dir, command = 'git push -u origin feat/probe') {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    timeout: 120_000,
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

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
    record(dir, 'feat/probe', headSha(dir));

    expect(push(dir).status).toBe(0);
  });

  it('refuses again once the diff changes', () => {
    // Keyed on the HEAD sha deliberately: a new commit is a new diff, and the previous round's review no
    // longer describes what would be sent. That property is the entire point.
    const dir = scratchRepo('feat/probe');
    record(dir, 'feat/probe', headSha(dir));
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
    record(dir, 'feat/probe', headSha(dir), 3);

    const verdict = push(dir);
    expect(verdict.status, 'a record with open findings satisfied the gate').toBe(2);
    expect(verdict.output).toMatch(/3 finding\(s\) still open/);
  });

  it('refuses a record whose findings count is unreadable', () => {
    // Absent is not zero. A record missing the field cannot say the review was clean.
    const dir = scratchRepo('feat/probe');
    const file = recordPathFor('feat/probe', path.join(dir, '.agents/local-reviews'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ branch: 'feat/probe', headSha: headSha(dir) }));

    expect(push(dir).status, 'a record with no findings field passed as clean').toBe(2);
  });

  it('refuses a push from a detached HEAD', () => {
    // No branch means no key for a record, and falling through produced one shared filename that
    // every detached push would satisfy for every other. The hygiene check above exempts the empty
    // case because it has nothing to compare; this one has something to protect and no key for it.
    const dir = scratchRepo('feat/probe');
    record(dir, 'feat/probe', headSha(dir));
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
    const dir = mkdtempSync(path.join(tmpdir(), 'record-'));
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
    const dir = mkdtempSync(path.join(tmpdir(), 'record-collide-'));
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
    const dir = mkdtempSync(path.join(tmpdir(), 'record-bad-'));
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
    const outside = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'));
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

describe('the skill still puts the round before the push', () => {
  const skill = readFileSync(SKILL, 'utf8');

  it('describes the local-diff round and the command that records it', () => {
    // The measured reason this changed, kept where the next reader of the skill will meet it.
    expect(skill).toMatch(/before any push/i);
    expect(skill).toMatch(/harness:review:record/);
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
