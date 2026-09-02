/**
 * INFRA-056 — the CI-mirror stage list and CI's required jobs cannot drift apart.
 *
 * The defect this guards: `verify-like-ci` was named as THE CI-equivalent verification entry point
 * while running neither `pnpm build` nor any package test suite. Nothing mechanical connected the
 * stage list to what CI actually requires, so the gap was invisible — and a HARNESS-049 increment
 * nearly replaced a skill's four hardcoded commands (which INCLUDED the package tests) with a
 * pointer to it, a "strengthening" that would have silently stopped running tests.
 *
 * The pin is STEP-level, not context-level, and that distinction is the whole point. A
 * context-level pin is satisfied by mapping `quality -> affected-verify` while `quality`'s other
 * two run-steps go unmirrored — it would certify coverage that does not exist, which is the
 * original defect wearing a test. Every command-executing step of every mirrored job must be
 * claimed by a stage or declared CI plumbing with a reason.
 *
 * Modelled on the workflow-to-classifier ownership assertion in
 * `classify-changed-paths.test.mjs`: parse the real owner relation rather than preserving
 * hand-copied lists.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CI_SETUP_STEPS,
  CI_STAGES,
  claimedSteps,
  jobRunSteps,
  MIRRORED_BRANCH,
  mirrorEntries,
  NOT_MIRRORED,
  plumbingSteps,
  readCiWorkflow,
  readRequiredContexts,
  RELEVANCE_KEYS,
  stagesMirroring,
} from '../ci-mirror-map.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CI_YAML = readCiWorkflow(REPO_ROOT);
const REQUIRED = readRequiredContexts(REPO_ROOT, MIRRORED_BRANCH);

/** Contexts the map claims it cannot reproduce. */
const notMirroredContexts = new Set(NOT_MIRRORED.map((entry) => entry.context));

/** Required contexts that a stage is expected to reproduce. */
const mirroredContexts = REQUIRED.filter((entry) => !notMirroredContexts.has(entry.context));

describe(`every required check on \`${MIRRORED_BRANCH}\` is answered for (anti-drift)`, () => {
  it('the declaration is non-empty — an empty list would pass everything vacuously', () => {
    expect(REQUIRED.length).toBeGreaterThan(0);
  });

  it.each(REQUIRED.map((entry) => entry.context))(
    '`%s` is either mirrored by a stage or declared un-mirrorable',
    (context) => {
      const entry = REQUIRED.find((candidate) => candidate.context === context);
      const stages = stagesMirroring(entry.job);
      const declared = NOT_MIRRORED.find((candidate) => candidate.context === context);
      expect(
        stages.length > 0 || Boolean(declared),
        `\`${context}\` is REQUIRED on \`${MIRRORED_BRANCH}\` but no verify-like-ci stage mirrors it and NOT_MIRRORED does not declare it. Add a stage, or declare why it cannot be run locally — a required check the entry point silently drops is the INFRA-056 defect.`,
      ).toBe(true);
    },
  );

  it.each(NOT_MIRRORED.map((entry) => entry.context))(
    '`%s` is declared un-mirrorable with a reason and a manual command',
    (context) => {
      const entry = NOT_MIRRORED.find((candidate) => candidate.context === context);
      expect(
        entry.reason.length,
        'a reason-less exemption rots into a silent omission',
      ).toBeGreaterThan(40);
      expect(entry.manualCommand.length).toBeGreaterThan(0);
      expect(entry.relevantWhen.length).toBeGreaterThan(0);
      // `relevantWhen` is prose; `relevance` is what the runner evaluates. A sentence with no key
      // behind it describes a condition nobody computes — the same defect, one size smaller.
      expect(
        RELEVANCE_KEYS,
        `\`${context}\` declares relevance \`${entry.relevance}\`, which the runner cannot evaluate.`,
      ).toContain(entry.relevance);
    },
  );

  it('NOT_MIRRORED names only contexts that are actually required', () => {
    const required = new Set(REQUIRED.map((entry) => entry.context));
    for (const entry of NOT_MIRRORED) {
      expect(
        required.has(entry.context),
        `NOT_MIRRORED declares \`${entry.context}\`, which \`${MIRRORED_BRANCH}\` does not require — a stale exemption reads as coverage nobody needs.`,
      ).toBe(true);
    }
  });
});

describe('every mirrored job is covered STEP for STEP (anti-drift)', () => {
  it('declares every explicit not-applicable CI outcome as local setup plumbing', () => {
    expect(CI_SETUP_STEPS.build.map((entry) => entry.step)).toContain(
      'Product verification not applicable',
    );
    // PROC-016: the PR body is CI transport for scan-lane-declaration; locally the lane comes from the
    // spec frontmatter and the commit trailers, so the step is plumbing, declared with its reason.
    expect(CI_SETUP_STEPS.scans.map((entry) => entry.step)).toContain(
      'Write pull request body for the lane declaration',
    );
    expect(CI_SETUP_STEPS.quality.map((entry) => entry.step)).toContain(
      'Product verification not applicable',
    );
    expect(CI_SETUP_STEPS['examples-typecheck'].map((entry) => entry.step)).toContain(
      'Examples verification not applicable',
    );
    expect(CI_SETUP_STEPS['tui-e2e'].map((entry) => entry.step)).toContain(
      'TUI verification not applicable',
    );
  });

  it.each(mirroredContexts.map((entry) => [entry.context, entry.job]))(
    '`%s` (job `%s`): every run-step is claimed by a stage or declared CI plumbing',
    (context, job) => {
      const steps = jobRunSteps(CI_YAML, job);
      const claimed = claimedSteps(job);
      const plumbing = plumbingSteps(job);
      const unanswered = steps.filter((step) => !claimed.has(step) && !plumbing.has(step));
      expect(
        unanswered,
        `ci.yml's REQUIRED job \`${job}\` runs step(s) that no verify-like-ci stage reproduces and CI_SETUP_STEPS does not declare plumbing: ${unanswered.join(', ')}. Add a stage for it, or declare it in CI_SETUP_STEPS with a reason. Leaving it unanswered means "I ran the CI-equivalent check" covers less than it claims (INFRA-056).`,
      ).toEqual([]);
    },
  );

  it.each(mirroredContexts.map((entry) => [entry.context, entry.job]))(
    '`%s` (job `%s`): no stage claims a step ci.yml no longer has',
    (context, job) => {
      const steps = new Set(jobRunSteps(CI_YAML, job));
      const phantom = [...claimedSteps(job)].filter((step) => !steps.has(step));
      expect(
        phantom,
        `verify-like-ci claims to mirror step(s) that ci.yml's \`${job}\` job no longer runs: ${phantom.join(', ')}. A stage mirroring a step that no longer exists is coverage of nothing.`,
      ).toEqual([]);
    },
  );

  it('CI_SETUP_STEPS declares no phantom step, and every entry carries a reason', () => {
    for (const [job, entries] of Object.entries(CI_SETUP_STEPS)) {
      const steps = new Set(jobRunSteps(CI_YAML, job));
      for (const entry of entries) {
        expect(
          steps.has(entry.step),
          `CI_SETUP_STEPS[${job}] names \`${entry.step}\`, which ci.yml does not run.`,
        ).toBe(true);
        expect(
          entry.reason.length,
          `CI_SETUP_STEPS[${job}].${entry.step} needs a reason.`,
        ).toBeGreaterThan(20);
      }
    }
  });
});

describe('the stage table itself is well-formed', () => {
  it('maps the three concurrent CI checks to independently gated local stages', () => {
    const contracts = CI_STAGES.find((stage) => stage.name === 'harness-self-test');
    const hermetic = CI_STAGES.find((stage) => stage.name === 'harness-hermetic-test');
    const scans = CI_STAGES.find((stage) => stage.name === 'scan-suite-dist-free');
    expect(contracts?.mirrors).toEqual([
      { job: 'scans', steps: ['Harness affected verification (concurrent, dist-independent)'] },
    ]);
    expect(hermetic?.mirrors).toEqual([
      { job: 'scans', steps: ['Harness affected verification (concurrent, dist-independent)'] },
    ]);
    expect(scans?.mirrors).toEqual([
      { job: 'scans', steps: ['Harness affected verification (concurrent, dist-independent)'] },
    ]);
  });

  it('every stage either mirrors a real ci.yml job or declares why it is extra', () => {
    for (const stage of CI_STAGES) {
      expect(
        Boolean(stage.mirrors) !== Boolean(stage.extra),
        `stage \`${stage.name}\` must be exactly one of mirrored or extra`,
      ).toBe(true);
      expect(stage.why.length, `stage \`${stage.name}\` needs a why`).toBeGreaterThan(20);
      for (const entry of mirrorEntries(stage)) {
        expect(() => jobRunSteps(CI_YAML, entry.job)).not.toThrow();
        expect(
          entry.steps.length,
          `stage \`${stage.name}\` mirrors \`${entry.job}\` but names no step`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('stage names are unique', () => {
    const names = CI_STAGES.map((stage) => stage.name);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * HARNESS-058 — a prerequisite must run BEFORE what needs it.
   *
   * `typecheck` was stage 5 and `build` stage 6, so a cross-package `tsgo` run resolved to
   * declaration files nothing had produced yet and the gate went red on a branch that changed no
   * code. The fix is not a one-off swap: every stage now DECLARES whether it reads build output,
   * and this pins the declaration to the order. A stage added below `build` needing dist is caught
   * here rather than by the next agent to run the gate in a fresh worktree.
   */
  it('every stage declares whether it reads build output', () => {
    for (const stage of CI_STAGES) {
      expect(
        typeof stage.needsBuildOutput,
        `stage \`${stage.name}\` must declare needsBuildOutput — the stage order is derived from it, and an undeclared stage silently sorts as "needs nothing".`,
      ).toBe('boolean');
    }
  });

  it('the build stage does not itself read build output', () => {
    const build = CI_STAGES.find((stage) => stage.name === 'build');
    expect(build, 'the stage that produces build output must exist').toBeDefined();
    expect(build.needsBuildOutput).toBe(false);
  });

  it('every stage that reads build output runs AFTER the stage that produces it', () => {
    const buildIndex = CI_STAGES.findIndex((stage) => stage.name === 'build');
    const tooEarly = CI_STAGES.filter(
      (stage, index) => stage.needsBuildOutput && index < buildIndex,
    ).map((stage) => stage.name);
    expect(
      tooEarly,
      `stage(s) that read build output are ordered BEFORE \`build\`: ${tooEarly.join(', ')}. On an unbuilt tree they fail on missing declaration files / modules, which reads as a defect in the change under test (HARNESS-058).`,
    ).toEqual([]);
  });

  it('no stage mirrors a job the ruleset does not require', () => {
    const requiredJobs = new Set(REQUIRED.map((entry) => entry.job));
    for (const stage of CI_STAGES) {
      for (const entry of mirrorEntries(stage)) {
        expect(
          requiredJobs.has(entry.job),
          `stage \`${stage.name}\` mirrors job \`${entry.job}\`, which \`${MIRRORED_BRANCH}\` does not require — the mirror table must track the required list, not an arbitrary job.`,
        ).toBe(true);
      }
    }
  });
});

describe('the build predicate has ONE implementation (anti-drift)', () => {
  /**
   * `ci.yml`'s "Detect build requirement" step still inlines the check set in a heredoc. Until that
   * call site imports the shared helper (follow-up INFRA-057), this pins the two together so the
   * copy cannot drift: `verify-like-ci` skipping `pnpm build` on a plan CI would have built for is
   * a fail-open the whole entry point rests on.
   */
  it('PACKAGE_DIST_CHECKS equals the set ci.yml inlines, entry for entry', async () => {
    const { PACKAGE_DIST_CHECKS } = await import('../check-plan.mjs');
    const literal = /checksRequiringPackageDist = new Set\(\[([^\]]*)\]\)/.exec(CI_YAML);
    expect(literal, 'ci.yml must still declare `checksRequiringPackageDist`').not.toBeNull();
    const fromWorkflow = [...literal[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect([...fromWorkflow].sort()).toEqual([...PACKAGE_DIST_CHECKS].sort());
  });
});

describe('the ruleset declaration matches the workflow it names', () => {
  /**
   * Resolve against the workflow each entry DECLARES, not against `ci.yml`.
   *
   * This assertion used to hardcode `ci.yml`, which held only because every required context
   * happened to live there. `review-gate` is the first that does not — it reads GitHub's
   * code-scanning API from `.github/workflows/review-gate.yml`. Pinning the filename would have
   * forced a genuinely-required context to be declared in the wrong workflow just to satisfy the
   * test, which is the test dictating the architecture rather than checking it.
   *
   * What actually matters is unchanged and still asserted for every entry: the declared workflow
   * exists, it really defines the named job, and the job's `name:` is the context string branch
   * protection matches on.
   */
  it.each(REQUIRED.map((entry) => [entry.context, entry.job]))(
    '`%s` resolves to job `%s` in the workflow it declares',
    (context, job) => {
      const declared = REQUIRED.find((entry) => entry.context === context);
      const workflowPath = path.join(REPO_ROOT, declared.workflow);
      expect(existsSync(workflowPath), `${declared.workflow} does not exist`).toBe(true);
      const source = readFileSync(workflowPath, 'utf8');
      expect(() => jobRunSteps(source, job)).not.toThrow();
      // The context string is the job's `name:`, which is what branch protection matches on.
      //
      // Accept the quoted spellings. A raw `toContain` held only while every context happened to be
      // a bare scalar; `regression-red-proof (enforcing: accidental-green only)` contains `: `, so
      // YAML REQUIRES quoting it and the unquoted form the assertion looked for cannot legally
      // exist. The property being checked is unchanged — the job's `name:` is the context string —
      // and the assertion now recognises the only spellings that can express it.
      const escaped = context.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        new RegExp(`^\\s*name:\\s*(['"]?)${escaped}\\1\\s*$`, 'm').test(source),
        `no job in ${declared.workflow} declares \`name: ${context}\` (bare or quoted)`,
      ).toBe(true);
    },
  );
});
