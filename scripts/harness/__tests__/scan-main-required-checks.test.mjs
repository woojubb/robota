import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DECLARATION_FILE,
  findRequiredCheckFindings,
  jobExcludesMain,
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
  const root = await mkdtemp(path.join(tmpdir(), 'robota-main-required-checks-'));
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

  it('[R6] is RED when a required job needs a job that is main-excluded', async () => {
    const workflow = `${TRIGGER}  gate:
    name: gate
    runs-on: ubuntu-latest
    if: github.base_ref != 'main'
    steps:
      - run: echo gate
  release-grade-verify:
    name: release-grade verification
    runs-on: ubuntu-latest
    needs: gate
    steps:
      - run: pnpm harness:verify:release
`;
    const root = await fixture({
      workflow,
      contexts: [entry('release-grade verification', 'release-grade-verify')],
    });
    const details = findRequiredCheckFindings(root).map((finding) => finding.detail);
    expect(details.some((detail) => detail.includes('[R6]'))).toBe(true);
  });

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
    // Admissible: no condition, or exactly `== main` in either quote style.
    expect(jobExcludesMain('    runs-on: ubuntu-latest\n')).toBe(false);
    expect(jobExcludesMain("    if: github.base_ref == 'main'\n")).toBe(false);
    expect(jobExcludesMain('    if: github.base_ref == "main"\n')).toBe(false);
    // Everything else, including spellings never anticipated, fails closed.
    expect(jobExcludesMain("    if: github.base_ref != 'main'\n")).toBe(true);
    expect(jobExcludesMain('    if: github.base_ref != "main"\n')).toBe(true);
    expect(jobExcludesMain("    if: github.base_ref == 'develop'\n")).toBe(true);
    expect(jobExcludesMain("    if: needs.changes.outputs.code == 'true'\n")).toBe(true);
    expect(jobExcludesMain('    if: false\n')).toBe(true);
  });

  it('splits steps and reads their conditions', () => {
    const steps = splitJobSteps(VACUOUS_JOB.replace(/^ {2}build:\n/, ''));
    expect(steps).toHaveLength(3);
    expect(stepCondition(steps[0])).toBe("github.base_ref == 'main'");
    expect(stepCondition(steps[1])).toBe("github.base_ref != 'main'");
  });

  it('reads the pull_request trigger, inline and block branch lists', () => {
    expect(pullRequestTrigger(TRIGGER)).toEqual({
      branches: ['main', 'develop'],
      types: ['opened', 'synchronize', 'reopened', 'edited'],
      hasPathFilter: false,
    });
    expect(
      pullRequestTrigger('on:\n  pull_request:\n    branches:\n      - main\n      - develop\n'),
    ).toEqual({ branches: ['main', 'develop'], types: undefined, hasPathFilter: false });
    expect(
      pullRequestTrigger("on:\n  pull_request:\n    paths-ignore:\n      - '**/*.md'\n"),
    ).toEqual({ branches: [], types: undefined, hasPathFilter: true });
  });

  // The scoping-bug class this suite already caught once (a `paths-ignore:` block list parsed as
  // branch names). Every block-list reader must be anchored to its own key.
  it("never reads a sibling block list as another key's values", () => {
    const trigger = pullRequestTrigger(
      "on:\n  pull_request:\n    branches:\n      - main\n    types:\n      - edited\n    paths-ignore:\n      - '**/*.md'\n",
    );
    expect(trigger).toEqual({ branches: ['main'], types: ['edited'], hasPathFilter: true });
  });
});
