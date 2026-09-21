/**
 * INFRA-2804 — gate coverage for `integration/**` bases.
 *
 * Two halves, and they fail for different reasons, so they are tested separately:
 *
 * 1. The workflow triggers must actually name `integration/**`, and must have been WIDENED rather
 *    than rewritten. The `types:` lists are load-bearing (INFRA-055 subscribes `edited` because
 *    retargeting a pull request's base fires `edited` and not `synchronize`), so a trigger block
 *    rewritten from scratch would break base-retargeting with nothing visibly failing.
 *
 * 2. `merge-gate.sh` must refuse a pull request that ran no repository gate check. GitHub reports
 *    `mergeStateStatus: CLEAN` for such a pull request — CLEAN means "no required check is failing",
 *    which an empty check list satisfies vacuously. The hook is driven here against recorded `gh`
 *    output rather than the live API: the point is what the hook DECIDES given a check list, and a
 *    test that needed a real zero-check pull request could only be run by first creating one.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { makeTemp } from './make-temp.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');

/** The four triggers INFRA-2804 widened, with the trigger key each one uses. */
const WIDENED = [
  ['ci.yml', 'pull_request'],
  ['gitleaks.yml', 'pull_request'],
  ['dependency-review.yml', 'pull_request'],
  ['workflow-provenance-gate.yml', 'pull_request_target'],
];

function workflow(file) {
  return parseYaml(readFileSync(path.join(WORKFLOWS, file), 'utf8'));
}

describe('INFRA-2804: the widened workflow triggers', () => {
  // TC-01, TC-02 — parsed, not grepped. A grep for `integration/**` passes on a commented-out line,
  // and this is exactly the class of check that must not be satisfiable by a comment.
  it.each(WIDENED)('%s names integration/** on %s, alongside main and develop', (file, key) => {
    const branches = workflow(file).on[key].branches;
    expect(branches).toContain('integration/**');
    expect(branches).toContain('main');
    expect(branches).toContain('develop');
  });

  // TC-09 — the constraint that is cheap to violate silently.
  it.each(WIDENED)('%s keeps its %s types list intact', (file, key) => {
    const types = workflow(file).on[key].types;
    expect(types).toContain('opened');
    expect(types).toContain('synchronize');
  });

  it('ci.yml still subscribes `edited`, which is what makes a base retarget re-dispatch', () => {
    // INFRA-055 measured this on throwaway PR #1442: retargeting a base fires `edited`, not
    // `synchronize`. Widening the branch list is what makes an integration child in scope; `edited`
    // is what makes a child RETARGETED to develop re-run the pipeline it just became subject to.
    expect(workflow('ci.yml').on.pull_request.types).toContain('edited');
    expect(workflow('workflow-provenance-gate.yml').on.pull_request_target.types).toContain(
      'edited',
    );
  });

  // TC-03 — the whole safety argument for touching no job body rests on this split holding.
  it('ci.yml jobs remain split on base_ref, so widening enables no promotion-only job', () => {
    const jobs = Object.entries(workflow('ci.yml').jobs);
    const conditionOf = ([, job]) => (job.if ? String(job.if) : null);

    const mainOnly = jobs.filter((j) => conditionOf(j)?.includes("base_ref == 'main'"));
    const gate = jobs.filter((j) => {
      const c = conditionOf(j);
      return c !== null && !c.includes("base_ref == 'main'") && c.includes("!= 'main'");
    });
    const unconditioned = jobs.filter((j) => conditionOf(j) === null);

    // Every job either skips on a non-main base by its own condition, runs as a gate, is a
    // workflow_dispatch benchmark, or is the single unconditioned path-filter job. The property
    // that matters is the last clause: no job both lacks a base condition and assumes develop/main.
    expect(mainOnly.length).toBeGreaterThan(0);
    expect(gate.length).toBeGreaterThan(0);
    expect(unconditioned.map(([name]) => name)).toEqual(['changes']);
  });
});

/**
 * Drive merge-gate.sh with a stubbed `gh` on PATH.
 *
 * The stub answers the three reads the hook makes before the point under test and echoes the
 * supplied rollup for the fourth. Returns the hook's exit code and stderr.
 */
function runMergeGate({ rollup, state = 'CLEAN' }) {
  const dir = makeTemp('robota-infra2804-');
  {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const rollupFile = path.join(dir, 'rollup.json');
    writeFileSync(rollupFile, JSON.stringify({ statusCheckRollup: rollup }));

    // A stub rather than a recording of the live API: the hook's decision is the subject, and the
    // only input that decision turns on is the rollup.
    writeFileSync(
      path.join(bin, 'gh'),
      [
        '#!/bin/bash',
        '# Extract the --jq filter by position rather than by string surgery: the hook passes it as',
        '# its own argument, and reconstructing it from "$*" loses the quoting.',
        'filter=""',
        'prev=""',
        'for a in "$@"; do',
        '  if [ "$prev" = "--jq" ]; then filter="$a"; fi',
        '  prev="$a"',
        'done',
        'args="$*"',
        'case "$args" in',
        `  *mergeStateStatus*) echo '${state}' ;;`,
        '  *labels*) echo "__labels__" ;;',
        `  *statusCheckRollup*) jq -r "$filter" ${rollupFile} ;;`,
        '  *) echo "" ;;',
        'esac',
      ].join('\n'),
      'utf8',
    );
    chmodSync(path.join(bin, 'gh'), 0o755);

    try {
      const stdout = execFileSync('bash', [path.join(ROOT, '.claude/hooks/merge-gate.sh')], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CLAUDE_PROJECT_DIR: ROOT,
          MERGE_GATE_TEST_PR: '9999',
        },
        input: JSON.stringify({ tool_input: { command: 'gh pr merge 9999 --merge' } }),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { code: 0, stderr: '', stdout };
    } catch (error) {
      return { code: error.status ?? -1, stderr: String(error.stderr ?? '') };
    }
  }
}

describe('INFRA-2804: merge-gate distinguishes an empty check list from a passing one', () => {
  // The exact shape measured on PR #2803: three external deploy checks with no workflowName, plus
  // one repository check that was SKIPPED. GitHub called this CLEAN.
  const VACUOUS = [
    { name: 'Claude review', conclusion: 'SKIPPED', workflowName: 'Claude Code Review' },
    { name: 'Cloudflare Pages: robota', conclusion: 'SUCCESS' },
    { name: 'Cloudflare Pages: robota-docs', conclusion: 'SUCCESS' },
    { name: 'Cloudflare Pages: robota-www', conclusion: 'SUCCESS' },
  ];

  // TC-06
  it('refuses a CLEAN pull request whose every check is external or skipped', () => {
    const { code, stderr } = runMergeGate({ rollup: VACUOUS });
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/ran NO repository gate check/);
    // The refusal must name the absence rather than report the merge state as acceptable.
    expect(stderr).toMatch(/an absence/i);
  });

  // TC-07 — without this, TC-06 passes trivially by refusing everything.
  it('does not refuse on this ground when repository gate checks actually ran', () => {
    const withGates = [
      ...VACUOUS,
      { name: 'format-check', conclusion: 'SUCCESS', workflowName: 'CI' },
      { name: 'scans', conclusion: 'SUCCESS', workflowName: 'CI' },
      { name: 'build', conclusion: 'SUCCESS', workflowName: 'CI' },
    ];
    const { stderr } = runMergeGate({ rollup: withGates });
    // It may still refuse further down for review reasons — that is a different gate and not this
    // test's subject. What must not appear is THIS refusal.
    expect(stderr).not.toMatch(/ran NO repository gate check/);
  });

  it('refuses an unreadable check list rather than treating it as empty', () => {
    // An absent rollup is not evidence of absent checks. The hook's own header: an unknown state is
    // not a clean one.
    const { code, stderr } = runMergeGate({ rollup: null });
    expect(code).not.toBe(0);
    // Tightened after this assertion was caught passing WITHOUT the hook change: a loose
    // /could not read/ also matches refusals from later gates, so it was green for the wrong
    // reason. It must name this check specifically.
    expect(stderr).toMatch(/could not read PR #\d+'s check list/);
  });
});
