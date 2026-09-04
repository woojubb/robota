import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { DISPOSITION_LABELS } from '../record-local-review.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/merge-gate.sh');
const WORKFLOW = path.join(WORKSPACE_ROOT, '.github/workflows/review-gate.yml');
const HEAD_OID = '2222222222222222222222222222222222222222';

/**
 * The disposition a merge is judged against belongs to the PR, not to a checkout (PROC-007).
 *
 * `re-plan` withdraws a change rather than patching it (`finding-depth.md`). #1557 stored that
 * decision in `.agents/local-reviews/<branch>.json` — gitignored, per-working-tree, keyed by the
 * LOCAL branch and HEAD — while the merge it was meant to stop is keyed by a PR number.
 * `worktree-parallel-orchestration` §5 has the orchestrator merge, never the implementer, so those
 * two are a different checkout by construction and the record cannot follow. Measured while judging
 * that PR: one worktree held the only record for its branch, and the clone that would run the merge
 * held a record for a DIFFERENT branch — so the gate answered one PR's merge with another PR's
 * disposition.
 *
 * Every case here therefore runs the hook from a directory that recorded nothing, and states the
 * world through `gh` — and, for the one fact `gh` is no longer trusted for, through `origin`. A test
 * that passed only where the record lives would prove nothing.
 *
 * Since issue #2309 the hook reads the base branch's tip from the branch itself (`git ls-remote
 * origin refs/heads/<baseRefName>`), because GitHub's `baseRefOid` lags it by minutes. So the
 * checkout that recorded nothing is a CLONE of a bare origin whose `develop` holds one commit, and
 * the base OID every case states through `gh` is that commit: the branch and the API agree, the
 * moved-base path stays out of these cases, and the hook's live read is exercised as written rather
 * than stubbed around. A clone with no `.agents/local-reviews` is still the orchestrator's position.
 */
const scratch = [];

/** The base branch's tip as `origin` serves it — fixed in `beforeAll`, once the fixture exists. */
let BASE_OID = '';
/** The clone the hook is judged from. */
let ELSEWHERE = '';
/** A review as the reviewer is contracted to write one — enough for the later checks to pass. */
let CLEARED = {};

function gitIn(dir, ...args) {
  return execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
  }).trim();
}

beforeAll(() => {
  const origin = scratchDir('merge-gate-disp-origin-');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=develop', origin]);

  const seed = scratchDir('merge-gate-disp-seed-');
  execFileSync('git', ['init', '--quiet', '--initial-branch=develop', seed]);
  gitIn(seed, 'config', 'user.email', 'proc007@example.test');
  gitIn(seed, 'config', 'user.name', 'PROC-007');
  writeFileSync(path.join(seed, 'README.md'), 'base\n');
  gitIn(seed, 'add', 'README.md');
  gitIn(seed, 'commit', '--quiet', '-m', 'develop base');
  BASE_OID = gitIn(seed, 'rev-parse', 'HEAD');
  gitIn(seed, 'push', '--quiet', origin, 'develop');

  ELSEWHERE = scratchDir('merge-gate-elsewhere-');
  execFileSync('git', ['clone', '--quiet', origin, ELSEWHERE]);

  CLEARED = {
    state: 'CLEAN',
    headAt: '2026-08-01T10:00:00Z',
    baseOid: BASE_OID,
    headOid: HEAD_OID,
    comments: [
      {
        author: { login: 'github-actions' },
        createdAt: '2026-08-01T10:05:00Z',
        body: `REVIEWED BASE: ${BASE_OID}\nREVIEWED HEAD: ${HEAD_OID}\nfine\nACTIONABLE FINDINGS: 0`,
      },
    ],
  };
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix) {
  const dir = makeTemp(prefix);
  scratch.push(dir);
  return dir;
}

/**
 * A PATH whose `gh` answers per PR NUMBER from a fixture.
 *
 * Keying the fixture by number rather than by a single world is the point: the assertion that the
 * gate reads `$PR` is only meaningful if two different PRs can disagree in the same run.
 */
function stubbedPath(prs) {
  const dir = scratchDir('merge-gate-disp-');

  const fixture = path.join(dir, 'fixture.json');
  writeFileSync(fixture, JSON.stringify(prs));

  const gh = path.join(dir, 'gh');
  writeFileSync(
    gh,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      `const prs = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));`,
      'const argv = process.argv.slice(2);',
      'const args = argv.join(" ");',
      '// `gh pr view <n> --json ...` — the number is the argument after `view`.',
      'const num = argv[argv.indexOf("view") + 1];',
      'const pr = prs[num] ?? {};',
      'if (args.includes("--json labels")) {',
      '  // A read that cannot be served must FAIL, not answer "no labels": the two are the states',
      '  // this gate exists to keep apart.',
      '  if (pr.labelsUnreadable) process.exit(1);',
      '  const jq = process.argv[process.argv.indexOf("--jq") + 1] ?? "";',
      '  // The hook prefixes a sentinel line so an empty label set stays distinguishable from an',
      '  // unreadable one. Honour whichever shape it asked for rather than inventing one — a stub',
      '  // that answered its own preferred shape would keep passing after the hook changed.',
      '  const names = pr.labels ?? [];',
      '  if (jq.includes("__labels__")) console.log(["__labels__", ...names].join("\\n"));',
      '  else if (jq.includes("\\"|\\"")) console.log(`|${names.join("|")}|`);',
      '  else console.log(names.join(","));',
      '  process.exit(0);',
      '}',
      '// The gate asks whether every inline finding was ANSWERED where it was raised. These cases',
      '// are about the disposition label, so they answer "none open" unless a case says otherwise.',
      'if (args.includes("repo view")) { console.log("woojubb/robota"); process.exit(0); }',
      'if (args.includes("reviewThreads")) {',
      '  // `gh api graphql` carries no `view` token, so the number cannot come from argv the way it',
      '  // does for `gh pr view`. Read it out of the query text instead — otherwise every case in a',
      '  // multi-PR file answers for whichever PR happens to be first, and the keying this file is',
      '  // about is not exercised for this check at all.',
      '  const q = /pullRequest\\(number:\\s*(\\d+)\\)/.exec(args);',
      '  const target = prs[q ? q[1] : num] ?? Object.values(prs)[0] ?? {};',
      '  if (target.threadsUnreadable) process.exit(1);',
      '  console.log(`${target.totalThreads ?? target.unresolved ?? 0} ${target.unresolved ?? 0}`);',
      '  process.exit(0);',
      '}',
      'if (args.includes("mergeStateStatus")) { console.log(pr.state ?? "CLEAN"); process.exit(0); }',
      'if (args.includes("baseRefOid") && args.includes("headRefOid")) {',
      '  // issue #2309: the base branch NAME rides along, so the hook can read the branch itself.',
      '  console.log(`${pr.baseOid ?? ""} ${pr.headOid ?? ""} ${pr.baseRefName ?? "develop"}`);',
      '  process.exit(0);',
      '}',
      'if (args.includes("--json commits")) { console.log(pr.headAt ?? ""); process.exit(0); }',
      'if (args.includes("--json comments")) {',
      '  const jq = process.argv[process.argv.indexOf("--jq") + 1] ?? "";',
      '  const comments = pr.comments ?? [];',
      '  const m = /test\\("(.*?)"\\)/.exec(jq);',
      '  const re = new RegExp(m ? m[1].replace(/\\\\\\\\/g, "\\\\") : "^$");',
      '  if (jq.includes("unique")) {',
      '    const logins = [...comments, ...(pr.reviews ?? [])].map((c) => c.author.login);',
      '    console.log([...new Set(logins)].join(", "));',
      '    process.exit(0);',
      '  }',
      '  // The hook selects the newest VERDICT across comments AND reviews (#1661). Honour each',
      '  // clause the query actually carries — author filter, marker filter, sort by timestamp —',
      '  // exactly as the decision-file stub does, so these cases judge the disposition label',
      '  // against the hook as it is, not as it was.',
      '  const entries = [',
      '    ...comments.map((c) => ({ login: c.author.login, body: c.body ?? "", at: c.createdAt ?? "" })),',
      '    ...(pr.reviews ?? []).map((r) => ({ login: r.author.login, body: r.body ?? "", at: r.submittedAt ?? "" })),',
      '  ];',
      '  let mine = entries.filter((c) => re.test(c.login));',
      '  if (jq.includes("ACTIONABLE FINDINGS")) {',
      '    mine = mine.filter((c) => /actionable findings:\\s*[0-9]+/i.test(c.body));',
      '  }',
      '  mine.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));',
      '  console.log(JSON.stringify(mine.at(-1) ?? {}));',
      '  process.exit(0);',
      '}',
      'if (args.includes("pr checks")) { process.exit(0); }',
      'process.exit(1);',
    ].join('\n'),
  );
  chmodSync(gh, 0o755);

  return `${dir}:${process.env.PATH}`;
}

/**
 * Judge a merge FROM A CHECKOUT THAT RECORDED NOTHING.
 *
 * `cwd` is the bare clone of the fixture origin and `CLAUDE_PROJECT_DIR` is removed, so no
 * `.agents/local-reviews` is reachable from here at all. That is the orchestrator's position, and
 * the whole defect.
 */
function judgeFromElsewhere(prs, command) {
  const env = { ...process.env, PATH: stubbedPath(prs) };
  delete env.CLAUDE_PROJECT_DIR;

  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    cwd: ELSEWHERE,
    env,
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('the merge gate reads the disposition from the PR, from any checkout', () => {
  it('refuses a PR whose finding-depth disposition withdrew the change', () => {
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labels: ['disposition-re-plan'] } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/disposition-re-plan/);
  });

  it('refuses it even when everything else about the PR is green', () => {
    // The point of stating this separately: a withdrawal is not a consequence of CI or of an
    // unresolved review. A withdrawn change that is clean, reviewed and counted at zero must still
    // not merge — otherwise the disposition only ever fires where some other check already did.
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labels: ['disposition-re-plan', 'review-findings-acknowledged'] } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(2);
    expect(
      verdict.output,
      'the acknowledge label overrode a withdrawal it does not speak for',
    ).toMatch(/disposition-re-plan/);
  });

  it('keys the disposition on the PR in the command, not on the local checkout', () => {
    // The measured failure restated as an assertion: two PRs, one withdrawn, one not, judged in the
    // same run. A gate reading local state would give both the same answer.
    const world = {
      7: { ...CLEARED, labels: [] },
      9: { ...CLEARED, labels: ['disposition-re-plan'] },
    };

    expect(judgeFromElsewhere(world, 'gh pr merge 9 --merge').status).toBe(2);
    const other = judgeFromElsewhere(world, 'gh pr merge 7 --merge');
    expect(other.status, other.output).toBe(0);
  });

  it('refuses when the PR labels cannot be read', () => {
    // Fail closed, like every other unreadable state in this hook: "I could not check" and "it is
    // not withdrawn" are the two answers a guard must never conflate.
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labelsUnreadable: true } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/could not read the labels/);
  });

  it('does not read a PR with no labels as unreadable', () => {
    const verdict = judgeFromElsewhere({ 7: { ...CLEARED, labels: [] } }, 'gh pr merge 7 --merge');

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output).toMatch(/READ IT/);
  });

  it('lets a contained change land, and says so', () => {
    // Containment is a resolution (`finding-depth.md`): the change lands under a labelled hold. It
    // must not block — but the person merging is the last one who can see the hold before it lands.
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labels: ['disposition-containment'] } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output).toMatch(/disposition-containment/);
  });

  it('matches whole label names, so a name containing the delimiter cannot forge one', () => {
    // GitHub permits `|` in a label name. Delimiting the joined list with `|` and asking whether
    // `|disposition-re-plan|` is a substring therefore lets ONE label named
    // `pre|disposition-re-plan|post` forge the withdrawal — and blocks a PR nobody withdrew, which
    // is the false refusal that teaches everyone to pass MERGE_GATE_ACK=1. `review-gate.yml` reads
    // the same question with whole-line equality; the two enforcement points must not disagree.
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labels: ['pre|disposition-re-plan|post'] } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('refuses a label page that could have been truncated, instead of assuming it was not', () => {
    // `gh pr view --json labels` reads `labels(first: 100)` and does not paginate. GitHub caps an
    // issue or PR at 100 labels, so a SHORT page is provably complete — but a FULL one is the single
    // state where that reasoning stops, and "the withdrawal might be on a page I did not read" is
    // not "not withdrawn". Review raised this as an assumption stated only in a comment; a comment
    // is not enforcement, so the full page is a refusal.
    const many = Array.from({ length: 100 }, (_, i) => `filler-${i}`);
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labels: many } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/label/i);
  });

  it('does not refuse a page that is merely large', () => {
    // The refusal must be the truncation boundary, not "a lot of labels" — a gate that blocked at
    // 99 would be friction with no defect behind it.
    const many = Array.from({ length: 99 }, (_, i) => `filler-${i}`);
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labels: many } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('spells the labels the same way the recorder and the required check do', () => {
    // Three surfaces hold these two strings: the recorder that PUBLISHES them, this hook, and
    // `review-gate.yml`. Two of the three are bash and YAML and cannot import the object, so the
    // duplication is unavoidable — what is avoidable is its drifting silently. A renamed label that
    // reached only the recorder would leave both gates green over every withdrawal.
    const hook = readFileSync(HOOK, 'utf8');
    const workflow = readFileSync(WORKFLOW, 'utf8');

    for (const label of Object.values(DISPOSITION_LABELS)) {
      expect(hook, `${label} is not read by merge-gate.sh`).toContain(label);
      expect(workflow, `${label} is not read by review-gate.yml`).toContain(label);
    }
  });

  it('keeps the required check reading the withdrawal without the code/docs classifier', () => {
    // The withdrawal step must not sit behind the classifier's verdict: a docs-only PR can be
    // withdrawn exactly like a code one, and #1436 is the measured cost of a gate that treats the
    // classifier's verdict as the question. It is also why the step runs before the checkout — the
    // withdrawal is decided without executing anything from the PR.
    //
    // Inside the `review-gate` job that verdict is spelled `needs.classify.outputs.code` — the
    // form the job's other steps use. `steps.classify` can occur only inside the `classify` job's
    // own `outputs:` block, so a pin forbidding that string alone could never go red (issue
    // #2407). Both spellings are forbidden, and the slice is bounded by the first checkout AFTER
    // the step: an anchor pinned to one checkout major version (`@v4`) silently became -1 when the
    // action was bumped, which stretched the slice to the end of the file.
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const start = workflow.indexOf('Has this change been withdrawn?');
    const end = workflow.indexOf('actions/checkout@', start);
    expect(start, 'the withdrawal step is missing').toBeGreaterThan(-1);
    expect(end, 'the withdrawal step is not ahead of the checkout').toBeGreaterThan(start);
    const step = workflow.slice(start, end);

    expect(step, 'the withdrawal was gated on the code/docs classifier').not.toMatch(
      /needs\.classify\.outputs\.code|steps\.classify/,
    );
    expect(step).toContain('disposition-re-plan');
  });

  it('does not mistake a label that merely contains the name', () => {
    // `|`-delimited membership, not a substring search: `disposition-re-planned` is a different
    // label and must not be read as the withdrawal.
    const verdict = judgeFromElsewhere(
      { 7: { ...CLEARED, labels: ['not-disposition-re-planned'] } },
      'gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(0);
  });
});
