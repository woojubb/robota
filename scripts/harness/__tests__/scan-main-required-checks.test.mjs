import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  DECLARATION_FILE,
  STRICT_POLICY_KEY,
  readDeclarationBranch,
  strictPolicyFindings,
} from '../required-status-checks-declaration.mjs';
import {
  declaredBranches,
  findContextNameFindings,
  findRequiredCheckFindings,
  publishedContexts,
  jobConditionProblem,
  reconcileLiveBranch,
  jobNeeds,
  pullRequestTrigger,
  splitJobSteps,
  stepCondition,
} from '../scan-main-required-checks.mjs';

/**
 * Every fixture below is a shape that ACTUALLY shipped or was actually proposed. The point of this
 * suite is that each assertion is red on the shape it targets — a scan proven only by its own green
 * run is the accidental-green failure this repo has recorded repeatedly (HARNESS-041).
 */

const TRIGGER = `name: CI
on:
  pull_request:
    branches: [main, develop]
    types: [opened, synchronize, reopened, edited]

jobs:
`;

/** The shape that made INFRA-055's required contexts no-ops on promotion #1427. */
const VACUOUS_JOB = `  build:
    name: build
    runs-on: ubuntu-latest
    steps:
      - name: Skip duplicate build for main PR
        if: github.base_ref == 'main'
        run: echo "build is covered by release-grade verification"
      - uses: actions/checkout@v7
        if: github.base_ref != 'main'
      - name: Build
        if: github.base_ref != 'main'
        run: pnpm build
`;

/** A job that does real, unconditional work on a \`main\` PR. */
const SUBSTANTIVE_JOB = `  release-grade-verify:
    name: release-grade verification
    runs-on: ubuntu-latest
    if: github.base_ref == 'main'
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - name: Run release-grade verification
        run: pnpm harness:verify:release
`;

async function fixture({ workflow, contexts }) {
  const root = makeTemp('robota-main-required-checks-');
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  if (workflow !== undefined) {
    writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), workflow, 'utf8');
  }
  if (contexts !== undefined) {
    writeFileSync(
      path.join(root, DECLARATION_FILE),
      JSON.stringify({ branches: { main: { required_status_checks: contexts } } }, null, 2),
      'utf8',
    );
  }
  return root;
}

const entry = (context, job) => ({ context, workflow: '.github/workflows/ci.yml', job });

describe('scan-main-required-checks', () => {
  it('passes for a required context whose job does unconditional work on a main PR', async () => {
    const root = await fixture({
      workflow: TRIGGER + SUBSTANTIVE_JOB,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    expect(findRequiredCheckFindings(root)).toEqual([]);
  });

  it('[R3] is RED for the #1427 echo shape — every real step gated on base_ref', async () => {
    const root = await fixture({
      workflow: TRIGGER + VACUOUS_JOB,
      contexts: [entry('build', 'build')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R3]'))).toBe(true);
    expect(details.join('\n')).toContain('github.base_ref');
  });

  // The three fixtures below were GREEN against the first draft, which blacklisted the single
  // spelling `base_ref != 'main'`. Each is one character or one omission away from a shape that
  // already caused a real incident, which is why the rule is now a whitelist.
  it('[R3] is RED for `!= "main"` in double quotes (the #1427 vacuous shape, one quote away)', async () => {
    const workflow = `${TRIGGER}  build:
    name: build
    runs-on: ubuntu-latest
    if: github.base_ref != "main"
    steps:
      - run: pnpm build
`;
    const root = await fixture({ workflow, contexts: [entry('build', 'build')] });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R3]'))).toBe(true);
  });

  it("[R3] is RED for `== 'develop'` (the #1436 permanent-pending shape)", async () => {
    const workflow = `${TRIGGER}  release-grade-verify:
    name: release-grade verification
    runs-on: ubuntu-latest
    if: github.base_ref == 'develop'
    steps:
      - run: pnpm harness:verify:release
`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R3]'))).toBe(true);
  });

  it('[R3] accepts `== "main"` in double quotes — the whitelist is quote-style agnostic', async () => {
    const workflow = `${TRIGGER}  release-grade-verify:
    name: release-grade verification
    runs-on: ubuntu-latest
    if: github.base_ref == "main"
    steps:
      - run: pnpm harness:verify:release
`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    expect(findRequiredCheckFindings(root)).toEqual([]);
  });

  it('[R7] is RED when `types:` is ABSENT — the default set omits `edited` (PR #1442)', async () => {
    const workflow = `name: CI
on:
  pull_request:
    branches: [main, develop]

jobs:
${SUBSTANTIVE_JOB}`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R7]'))).toBe(true);
    expect(details.join('\n')).toContain('#1442');
  });

  it('[R7] is RED when `types:` is present but omits `edited`', async () => {
    const workflow = `name: CI
on:
  pull_request:
    branches: [main, develop]
    types: [opened, synchronize, reopened]

jobs:
${SUBSTANTIVE_JOB}`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R7]'))).toBe(true);
  });

  it('[R3] is RED when the job itself is excluded on a main PR', async () => {
    const workflow = `${TRIGGER}  commitlint:
    name: commitlint
    runs-on: ubuntu-latest
    if: github.base_ref != 'main'
    steps:
      - run: pnpm exec commitlint
`;
    const root = await fixture({ workflow, contexts: [entry('commitlint', 'commitlint')] });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R3]'))).toBe(true);
  });

  it('[R2] is RED when the workflow carries a path filter (the #1436 never-reports shape)', async () => {
    const workflow = `name: CodeQL
on:
  pull_request:
    branches: [main, develop]
    paths-ignore:
      - '**/*.md'

jobs:
${SUBSTANTIVE_JOB}`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R2]'))).toBe(true);
    expect(details.join('\n')).toContain('paths-ignore');
  });

  it('[R2] is RED when the trigger does not cover main at all', async () => {
    const workflow = `name: CI
on:
  pull_request:
    branches: [develop]

jobs:
${SUBSTANTIVE_JOB}`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R2]'))).toBe(true);
  });

  it('[R5] is RED for continue-on-error — the one FAIL-OPEN rot', async () => {
    const workflow = `${TRIGGER}  release-grade-verify:
    name: release-grade verification
    runs-on: ubuntu-latest
    if: github.base_ref == 'main'
    continue-on-error: true
    steps:
      - run: pnpm harness:verify:release
`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R5]'))).toBe(true);
  });

  // R6 — "a required job needs a job that is main-excluded" — was removed by a harness audit that
  // measured it down to zero live subjects, and this fixture moved with the rule to
  // `scan-required-check-needs.test.mjs`, which is now the sole owner of the `needs:` graph. Its
  // red was reproduced there before the rule was deleted, so the coverage moved rather than ending.

  it('[R1] is RED when the job publishes a different context name', async () => {
    const root = await fixture({
      workflow: TRIGGER + SUBSTANTIVE_JOB,
      contexts: [entry('release-grade verify', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R1]'))).toBe(true);
  });

  it('[R1] is RED when the declared job does not exist', async () => {
    const root = await fixture({
      workflow: TRIGGER + SUBSTANTIVE_JOB,
      contexts: [entry('release-grade verification', 'gone')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R1]'))).toBe(true);
  });

  it('refuses an empty declaration rather than passing vacuously', async () => {
    const root = await fixture({ workflow: TRIGGER + SUBSTANTIVE_JOB, contexts: [] });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.join('\n')).toContain('vacuously');
  });

  it('refuses a missing declaration rather than passing vacuously', async () => {
    const root = await fixture({ workflow: TRIGGER + SUBSTANTIVE_JOB });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.join('\n')).toContain('missing');
  });
});

describe('scan-main-required-checks parsing helpers', () => {
  it('reads inline and block `needs:`', () => {
    expect(jobNeeds('    needs: build\n')).toEqual(['build']);
    expect(jobNeeds('    needs: [build, changes]\n')).toEqual(['build', 'changes']);
    expect(jobNeeds('    needs:\n      - build\n      - changes\n')).toEqual(['build', 'changes']);
    expect(jobNeeds('    runs-on: ubuntu-latest\n')).toEqual([]);
  });

  it('whitelists job conditions rather than blacklisting one spelling', () => {
    // Asked of `jobConditionProblem` directly. This whitelist used to be tested only through
    // `jobExcludesMain`, a one-line wrapper whose sole production caller was R6 — so removing R6
    // left the wrapper dead AND left the live function with no test of its own. Review caught it,
    // and it is the same L6 class the ledger in this change tracks.
    //
    // Admissible: no condition, or exactly `== main` in either quote style — `undefined`, meaning
    // no problem.
    expect(jobConditionProblem('    runs-on: ubuntu-latest\n')).toBeUndefined();
    expect(jobConditionProblem("    if: github.base_ref == 'main'\n")).toBeUndefined();
    expect(jobConditionProblem('    if: github.base_ref == "main"\n')).toBeUndefined();
    // Everything else, including spellings never anticipated, fails closed — and the finding NAMES
    // the condition, which the boolean wrapper threw away.
    expect(jobConditionProblem("    if: github.base_ref != 'main'\n")).toBe(
      "github.base_ref != 'main'",
    );
    expect(jobConditionProblem('    if: github.base_ref != "main"\n')).toBe(
      'github.base_ref != "main"',
    );
    expect(jobConditionProblem("    if: github.base_ref == 'develop'\n")).toBe(
      "github.base_ref == 'develop'",
    );
    expect(jobConditionProblem("    if: needs.changes.outputs.code == 'true'\n")).toBe(
      "needs.changes.outputs.code == 'true'",
    );
    expect(jobConditionProblem('    if: false\n')).toBe('false');
  });

  it('splits steps and reads their conditions', () => {
    const steps = splitJobSteps(VACUOUS_JOB.replace(/^ {2}build:\n/, ''));
    expect(steps).toHaveLength(3);
    expect(stepCondition(steps[0])).toBe("github.base_ref == 'main'");
    expect(stepCondition(steps[1])).toBe("github.base_ref != 'main'");
  });

  it('reads the pull_request trigger, inline and block branch lists', () => {
    expect(pullRequestTrigger(TRIGGER)).toEqual({
      kind: 'pull_request',
      branches: ['main', 'develop'],
      types: ['opened', 'synchronize', 'reopened', 'edited'],
      hasPathFilter: false,
    });
    expect(
      pullRequestTrigger('on:\n  pull_request:\n    branches:\n      - main\n      - develop\n'),
    ).toEqual({
      kind: 'pull_request',
      branches: ['main', 'develop'],
      types: undefined,
      hasPathFilter: false,
    });
    expect(
      pullRequestTrigger("on:\n  pull_request:\n    paths-ignore:\n      - '**/*.md'\n"),
    ).toEqual({ kind: 'pull_request', branches: [], types: undefined, hasPathFilter: true });
  });

  // INFRA-097. The trusted control plane runs on `pull_request_target` BECAUSE `pull_request` loads
  // its definition from the pull request under test. A reader that knew only the first would have
  // reported R2 "declares no trigger this scan can read" for the one workflow whose plane is the
  // point — refusing the fix as if it were the defect.
  it('[R2] reads a pull_request_target trigger and names which plane it found', () => {
    expect(
      pullRequestTrigger(
        'on:\n  pull_request_target:\n    branches: [main, develop]\n    types: [opened, synchronize, reopened, edited]\n',
      ),
    ).toEqual({
      kind: 'pull_request_target',
      branches: ['main', 'develop'],
      types: ['opened', 'synchronize', 'reopened', 'edited'],
      hasPathFilter: false,
    });
  });

  // The two planes are distinguished, not conflated: `pull_request:` must not match the longer key,
  // or a `pull_request_target`-only workflow would be reported under the wrong name in every message.
  it('does not read `pull_request_target:` as `pull_request:`', () => {
    const target = pullRequestTrigger(
      'on:\n  pull_request_target:\n    branches: [main]\n    types: [edited]\n',
    );
    expect(target?.kind).toBe('pull_request_target');
    const plain = pullRequestTrigger('on:\n  pull_request:\n    branches: [main]\n');
    expect(plain?.kind).toBe('pull_request');
    expect(pullRequestTrigger('on:\n  push:\n    branches: [main]\n')).toBeUndefined();
  });

  // R7 is about the RETARGET path and is plane-independent: `edited` is absent from GitHub's default
  // activity set on both, so a base moved develop->main re-dispatches nothing either way.
  it('[R7] applies to the target plane too — an `edited`-less types: is still the failing case', () => {
    const trigger = pullRequestTrigger(
      'on:\n  pull_request_target:\n    branches: [main]\n    types: [opened, synchronize]\n',
    );
    expect(trigger?.kind).toBe('pull_request_target');
    expect(trigger?.types).not.toContain('edited');
  });

  // The scoping-bug class this suite already caught once (a `paths-ignore:` block list parsed as
  // branch names). Every block-list reader must be anchored to its own key.
  it("never reads a sibling block list as another key's values", () => {
    const trigger = pullRequestTrigger(
      "on:\n  pull_request:\n    branches:\n      - main\n    types:\n      - edited\n    paths-ignore:\n      - '**/*.md'\n",
    );
    expect(trigger).toEqual({
      kind: 'pull_request',
      branches: ['main'],
      types: ['edited'],
      hasPathFilter: true,
    });
  });
});

/**
 * issue #2036 — R1's reasoning is not `main`-specific, and its scope was.
 *
 * "Branch protection matches on the context NAME, so a required context nothing publishes never
 * reports and blocks the PR forever" is a fact about how branch protection matches. It is identical
 * on `develop`, which had no equivalent check.
 *
 * MEASURED when this was written: `develop`'s `deliberately_not_required` named `patch-coverage` and
 * `regression-red-proof` while the jobs publish `patch-coverage (advisory)` and
 * `regression-red-proof (enforcing: accidental-green only)`. Neither was required, so neither was
 * harmful — and both were staged for promotion, where moving the entry verbatim would have required
 * a name nothing publishes and stranded every `develop` pull request.
 */
describe('a declared context name must be one a workflow actually publishes (issue #2036)', () => {
  /**
   * FIXTURE, not the real tree. The harness test tier runs from a temporary clone that carries no
   * `.github`, and these finders now THROW there by design — so a case that reads the real
   * repository passes locally and fails in the tier that actually gates the push. The assertion
   * "this repository declares nothing unpublished" belongs to the SCAN, which runs over the real
   * tree on every `pnpm harness:scan`; it is not a unit test's job.
   */
  function fixtureRoot({ workflows, declaration }) {
    const root = makeTemp('ctxname-');
    mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    for (const [file, text] of Object.entries(workflows)) {
      writeFileSync(path.join(root, '.github', 'workflows', file), text, 'utf8');
    }
    writeFileSync(
      path.join(root, '.github', 'required-status-checks.json'),
      JSON.stringify(declaration),
      'utf8',
    );
    return root;
  }

  it('reads the published names from the job `name:`, falling back to the job id', () => {
    const root = fixtureRoot({
      workflows: {
        'ci.yml':
          'jobs:\n  red-proof:\n    name: regression-red-proof (enforcing: accidental-green only)\n    steps: []\n  build:\n    steps: []\n',
      },
      declaration: { branches: { main: { required_status_checks: [{ context: 'build' }] } } },
    });
    const published = publishedContexts(root);
    // Both spellings: a job with an explicit display name, and one that publishes its job id.
    expect(published.has('regression-red-proof (enforcing: accidental-green only)')).toBe(true);
    expect(published.has('build')).toBe(true);
  });

  it('covers EVERY declared branch, not only `main`', () => {
    const root = fixtureRoot({
      workflows: { 'ci.yml': 'jobs:\n  a:\n    steps: []\n' },
      declaration: {
        branches: {
          main: { required_status_checks: [{ context: 'a' }] },
          develop: { required_status_checks: [{ context: 'a' }] },
        },
      },
    });
    expect(declaredBranches(root)).toEqual(['main', 'develop']);
  });

  it('reports nothing when every declared name is published', () => {
    const root = fixtureRoot({
      workflows: { 'ci.yml': 'jobs:\n  a:\n    name: quality\n    steps: []\n' },
      declaration: {
        branches: {
          main: { required_status_checks: [{ context: 'quality' }] },
          develop: { required_status_checks: [{ context: 'quality' }] },
        },
      },
    });
    expect(findContextNameFindings(root)).toEqual([]);
  });

  it('FAILS CLOSED rather than reporting nothing when the declaration is absent', () => {
    const bare = makeTemp('ctxname-bare-');
    // Measured before the guard existed: this returned `[]`, which reads as "every declared name is
    // published" over a tree that was never read.
    expect(() => findContextNameFindings(bare)).toThrow(/nothing was examined/);
  });

  it('FAILS CLOSED when the workflows directory is absent', () => {
    const root = makeTemp('ctxname-nowf-');
    mkdirSync(path.join(root, '.github'), { recursive: true });
    writeFileSync(
      path.join(root, '.github', 'required-status-checks.json'),
      JSON.stringify({ branches: { main: { required_status_checks: [{ context: 'a' }] } } }),
      'utf8',
    );
    expect(() => findContextNameFindings(root)).toThrow(/broken checkout/);
  });

  it('reports a develop-side entry whose name no job publishes', () => {
    const root = makeTemp('ctxname-');
    mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      path.join(root, '.github', 'workflows', 'ci.yml'),
      'jobs:\n  red-proof:\n    name: regression-red-proof (enforcing: accidental-green only)\n    steps: []\n',
      'utf8',
    );
    writeFileSync(
      path.join(root, '.github', 'required-status-checks.json'),
      JSON.stringify({
        branches: {
          develop: {
            required_status_checks: [{ context: 'regression-red-proof' }],
          },
        },
      }),
      'utf8',
    );

    const findings = findContextNameFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].context).toBe('regression-red-proof');
    expect(findings[0].detail).toMatch(/branches\.develop\.required_status_checks/);
    expect(findings[0].detail).toMatch(/permanently pending/);
  });

  it('checks `deliberately_not_required` too, because that list is where a promotion starts', () => {
    const root = makeTemp('ctxname-');
    mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      path.join(root, '.github', 'workflows', 'ci.yml'),
      'jobs:\n  cov:\n    name: patch-coverage (advisory)\n    steps: []\n',
      'utf8',
    );
    writeFileSync(
      path.join(root, '.github', 'required-status-checks.json'),
      JSON.stringify({
        branches: {
          develop: {
            required_status_checks: [{ context: 'patch-coverage (advisory)' }],
            deliberately_not_required: [{ context: 'patch-coverage', reason: 'advisory' }],
          },
        },
      }),
      'utf8',
    );

    const findings = findContextNameFindings(root);
    expect(findings.map((f) => f.context)).toEqual(['patch-coverage']);
    expect(findings[0].detail).toMatch(/deliberately_not_required/);
  });

  it('skips a grouped label that names several contexts in one string', () => {
    const root = makeTemp('ctxname-');
    mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      path.join(root, '.github', 'workflows', 'ci.yml'),
      'jobs:\n  a:\n    steps: []\n',
      'utf8',
    );
    writeFileSync(
      path.join(root, '.github', 'required-status-checks.json'),
      JSON.stringify({
        branches: {
          develop: {
            required_status_checks: [{ context: 'a' }],
            deliberately_not_required: [{ context: 'build / quality / scans', reason: 'grouped' }],
          },
        },
      }),
      'utf8',
    );
    expect(findContextNameFindings(root)).toEqual([]);
  });
});

/**
 * INFRA-162 (issue #2219) — the STRICT status-check policy ("require branches to be up to date
 * before merging") was live on both rulesets, declared by nothing, and discarded by the reconciler:
 * `reconcileLiveBranch` reduced each live `required_status_checks` rule to its contexts, so flipping
 * the flag in the GitHub UI in either direction produced no finding and `ruleset-drift.yml` reported
 * success. That is `enforcement-architecture.md` § "Silence is not success" exactly: the reconciler
 * did not check, and reported as if it had.
 *
 * Every case below runs over a FIXTURE live payload — the shape `/rules/branches/{branch}` returns —
 * so the comparison is proved without `--live` and the offline half stays hermetic.
 */
describe('strict status-check policy is declared and reconciled (INFRA-162, issue #2219)', () => {
  /** The live payload shape, reduced to what this assertion reads. */
  const livePayload = (parameters) => [
    { type: 'required_status_checks', parameters },
    { type: 'non_fast_forward', parameters: null },
  ];
  const checks = [{ context: 'build' }];

  it('reports nothing when the declared value and the live value agree', () => {
    for (const value of [true, false]) {
      expect(
        strictPolicyFindings({
          branchName: 'develop',
          rules: livePayload({
            required_status_checks: checks,
            strict_required_status_checks_policy: value,
          }),
          branch: { strict_required_status_checks_policy: value },
        }),
      ).toEqual([]);
    }
  });

  it.each([
    ['declared false, live true', false, true],
    ['declared true, live false', true, false],
  ])('is RED on disagreement in each direction (%s)', (_name, declared, live) => {
    const findings = strictPolicyFindings({
      branchName: 'develop',
      rules: livePayload({
        required_status_checks: checks,
        strict_required_status_checks_policy: live,
      }),
      branch: { strict_required_status_checks_policy: declared },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain(`declares \`${STRICT_POLICY_KEY}: ${declared}\``);
    expect(findings[0].detail).toContain(`the LIVE ruleset holds \`${live}\``);
    expect(findings[0].detail).toContain('develop');
  });

  // TC-03: unknown is not `false`. Each shape below would silently have read as "strict is off"
  // under any `?? false` default, which is the same silence the scan exists to break.
  it.each([
    [
      'the rule parameters carry no strict key',
      livePayload({ required_status_checks: checks }),
      /carries no `strict_required_status_checks_policy`/,
    ],
    [
      'the live read returns no required_status_checks rule at all',
      [{ type: 'non_fast_forward', parameters: null }],
      /no `required_status_checks` rule/,
    ],
    [
      'the rule parameters are null',
      [{ type: 'required_status_checks', parameters: null }],
      /carries no `strict_required_status_checks_policy`/,
    ],
    [
      'the strict value is not a boolean',
      livePayload({
        required_status_checks: checks,
        strict_required_status_checks_policy: 'false',
      }),
      /is not a boolean/,
    ],
  ])('refuses rather than defaulting when %s', (_name, rules, pattern) => {
    const findings = strictPolicyFindings({
      branchName: 'main',
      rules,
      branch: { strict_required_status_checks_policy: false },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(pattern);
  });

  it('refuses a declaration that omits the key, rather than assuming a value', () => {
    const findings = strictPolicyFindings({
      branchName: 'develop',
      rules: livePayload({
        required_status_checks: checks,
        strict_required_status_checks_policy: false,
      }),
      branch: { required_status_checks: checks },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain(DECLARATION_FILE);
    expect(findings[0].detail).toContain(STRICT_POLICY_KEY);
  });
});

/**
 * INFRA-162 TC-01 — the tracked declaration itself, not a fixture. The value declared MUST be the
 * value the ruleset held when it was declared (`develop` `false`, `main` `true`, measured with
 * `gh api repos/woojubb/robota/rules/branches/<branch>` on 2026-09-05): declaring the value someone
 * would prefer makes the first `--live` run red about a setting nobody agreed to change. A branch
 * that omits the key or its reason is exactly the silence this unit exists to end.
 */
describe('the tracked declaration records the strict policy each ruleset holds (INFRA-162 TC-01)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

  // This file runs in the HERMETIC tier, a tree stripped of every live-tree owner — only
  // `scripts/harness` is copied there, so `.github/required-status-checks.json` is absent by
  // construction. Reading the tracked declaration is exactly the live-tree dependency that tier
  // exists to exclude, so the assertion is skipped there and kept where the file is present. It is
  // not weakened: the same declaration is asserted over a fixture in every other case below, and
  // TC-01's own recorded command reads the tracked file directly.
  const declarationIsPresent = existsSync(
    path.join(REPO_ROOT, '.github/required-status-checks.json'),
  );

  it.each([
    ['develop', false],
    ['main', true],
  ])('declares `%s` with the measured value %s and a stated reason', (branchName, measured) => {
    if (!declarationIsPresent) return;
    const branch = readDeclarationBranch(REPO_ROOT, branchName);
    expect(branch).not.toBeNull();
    expect(branch[STRICT_POLICY_KEY]).toBe(measured);
    expect(typeof branch.strict_policy_why).toBe('string');
    expect(branch.strict_policy_why.length).toBeGreaterThan(50);
    expect(branch.strict_policy_why).toContain('INFRA-162');
  });

  it('refuses a missing declaration file rather than reading it as "no branch declared"', () => {
    const root = makeTemp('rsc-decl-missing-');
    expect(() => readDeclarationBranch(root, 'develop')).toThrow(/is missing/);
  });

  it('returns null for a branch the declaration does not carry, so the strict assertion can name it', () => {
    const root = makeTemp('rsc-decl-nobranch-');
    mkdirSync(path.join(root, '.github'), { recursive: true });
    writeFileSync(
      path.join(root, DECLARATION_FILE),
      JSON.stringify({ branches: { develop: { required_status_checks: [{ context: 'build' }] } } }),
    );
    expect(readDeclarationBranch(root, 'main')).toBeNull();
    const findings = strictPolicyFindings({
      branchName: 'main',
      rules: [
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [{ context: 'build' }],
            strict_required_status_checks_policy: true,
          },
        },
      ],
      branch: readDeclarationBranch(root, 'main'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('declares no `branches.main`');
  });
});

// The pure `strictPolicyFindings` tests above stay green even if `reconcileLiveBranch` never calls
// it — a check installed in the wiring slot that cannot go red is the defect one layer up. These
// drive the reconciler itself with an injected live payload, so removing the call fails them.
describe('the live reconciler actually consults the strict policy (INFRA-162 wiring)', () => {
  function declarationRoot(strict) {
    const root = makeTemp('strict-wiring-');
    mkdirSync(path.dirname(path.join(root, DECLARATION_FILE)), { recursive: true });
    writeFileSync(
      path.join(root, DECLARATION_FILE),
      JSON.stringify({
        branches: {
          develop: {
            required_status_checks: [{ context: 'build' }],
            [STRICT_POLICY_KEY]: strict,
            strict_policy_why: 'declared for this fixture',
          },
        },
      }),
    );
    return root;
  }

  const liveRules = (strict) => () => [
    {
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'build' }],
        strict_required_status_checks_policy: strict,
      },
    },
  ];

  it('reports nothing when the live flag matches what the declaration records', () => {
    const findings = reconcileLiveBranch(declarationRoot(false), 'develop', liveRules(false));
    expect(findings).toEqual([]);
  });

  it('reports the disagreement when the live flag has moved away from the declaration', () => {
    const findings = reconcileLiveBranch(declarationRoot(false), 'develop', liveRules(true));
    expect(findings).toHaveLength(1);
    expect(findings[0].context).toContain('strict policy');
    expect(findings[0].detail).toMatch(/true/);
  });
});
