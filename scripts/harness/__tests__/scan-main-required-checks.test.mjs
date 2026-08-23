import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  DECLARATION_FILE,
  declaredBranches,
  findContextNameFindings,
  findRequiredCheckFindings,
  publishedContexts,
  jobConditionProblem,
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
