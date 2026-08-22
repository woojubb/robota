/**
 * INFRA-097 (issue #1719) — the trusted plane must stay trusted, and stay harmless.
 *
 * This file asserts properties of a WORKFLOW rather than of code, because the workflow is the
 * security boundary here and a single added line is what would breach it. `pull_request_target`
 * runs with write credentials against the base; a `ref:` pointing at the PR head would turn this
 * gate into the pwn-request it exists to avoid, and that edit looks innocuous in a diff.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findWorkflowProvenanceFindings,
  readGuardedWorkflows,
} from '../scan-workflow-provenance.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const GATE_RELATIVE = '.github/workflows/workflow-provenance-gate.yml';
const GATE = readFileSync(path.join(ROOT, GATE_RELATIVE), 'utf8');

/** The job body, so an assertion about steps cannot be satisfied by a line in the header comment. */
const STEPS = GATE.slice(GATE.indexOf('    steps:'));

describe('the gate loads its definition from a place the pull request cannot edit', () => {
  it('is triggered by pull_request_target, not pull_request', () => {
    // The whole property. `pull_request` would load this file from the PR's merge revision, which is
    // the exposure — the change would carry the definition that judges it.
    expect(GATE).toMatch(/^on:\n\s{2}pull_request_target:/m);
    expect(GATE).not.toMatch(/^\s{2}pull_request:/m);
  });

  // A required context must be able to REPORT on every shape of pull request that can reach it, and
  // a retarget is one of those shapes. `edited` is the only activity that fires when a base moves,
  // and GitHub's default set omits it — so without this line a branch retargeted develop->main would
  // keep the conclusion it earned against the OLD base while branch protection reports the context
  // satisfied. Measured on throwaway PR #1442 for the other plane; `scan-main-required-checks` R7
  // encodes it, and this asserts the gate itself satisfies the rule it is about to be required under.
  it('handles `edited`, so a base retarget re-dispatches instead of keeping a stale conclusion', () => {
    const types = /^\s{4}types:\s*\[(.*)\]/m.exec(GATE)?.[1] ?? '';
    expect(types).toMatch(/\bedited\b/);
    expect(types).toMatch(/\bopened\b/);
    expect(types).toMatch(/\bsynchronize\b/);
    expect(types).toMatch(/\breopened\b/);
  });

  // The other half of R2: a path filter means some pull-request shape never triggers the workflow at
  // all, and a required context that never reports blocks the pull request forever with no way to
  // satisfy it (the #1436 rollback).
  it('carries no paths filter, so no pull request shape escapes it', () => {
    expect(GATE).not.toMatch(/^\s{4}paths(-ignore)?:/m);
  });
});

describe('and never runs the pull request it is judging', () => {
  // Measured on throwaway PR #2034: naming NO ref did not check out the base. `actions/checkout`
  // resolved to the repository's default branch, so a pull request to `develop` was judged with
  // `main`'s registry and `main`'s copy of the scan while its diff came from `develop`. The ref is
  // now named, and named as `base.sha` — the base, never the head.
  it("checks out the pull request's OWN base by sha, not whatever the default branch is", () => {
    expect(STEPS).toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/);
  });

  it('checks out no head ref, so the pull request never lands in the working tree', () => {
    // The single line that would breach this: `ref: ${{ github.event.pull_request.head.sha }}`.
    // Under `pull_request_target` that is PR code executing with write credentials against the base.
    expect(STEPS).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/);
    expect(STEPS).not.toMatch(/ref:\s*\$\{\{\s*github\.head_ref/);
  });

  it('fetches the pull request head rather than checking it out', () => {
    // Reading a file NAME is not running the file. That distinction is what lets the guard be
    // trusted while its subject is not, so it is asserted rather than left to the reader.
    expect(STEPS).toContain('git fetch');
    expect(STEPS).toMatch(/pull\/\$\{?PR_NUMBER\}?\/head/);
  });

  it('installs nothing', () => {
    // A dependency install runs whatever a PR-supplied manifest and lockfile ask for, which is PR
    // code by another route. The scan this job runs imports Node builtins and base files only.
    expect(STEPS).not.toMatch(/pnpm\s+install|npm\s+(ci|install)|yarn\s+install/);
  });

  it('holds contents: read and nothing else', () => {
    const permissions = /^permissions:\n((?:\s{2}\S.*\n)+)/m.exec(GATE)?.[1] ?? '';
    expect(permissions.trim()).toBe('contents: read');
  });
});

describe('what it judges', () => {
  it('runs the provenance scan against the base and the fetched head', () => {
    expect(STEPS).toContain('scan-workflow-provenance.mjs');
    expect(STEPS).toContain('--base-ref');
    expect(STEPS).toContain('--head-ref FETCH_HEAD');
  });

  it('has something to guard — the registry names at least one required workflow', () => {
    // A gate over an empty set passes forever. The scan itself fails closed on this, and asserting
    // it here means the guarded set being emptied shows up as a test failure rather than as a green
    // run over nothing.
    const { workflows } = readGuardedWorkflows(ROOT);
    expect(workflows.length).toBeGreaterThan(0);
  });

  // INFRA-097 step 5 CORRECTS this case rather than keeping it. It previously asserted the gate was
  // NOT in the guarded set, reasoning that self-guarding meant "a change editing it would be judged
  // by the edited version". That premise is true of a `pull_request` workflow and FALSE of this one,
  // which is the whole reason the plane was split: `pull_request_target` loads its definition from
  // the BASE, so a change editing this file is judged by the base's copy of it, and the edit takes
  // effect only after merge — after the gate it would have moved has already run.
  //
  // So once this gate provides a required context it SHOULD guard itself: an edit to the control
  // plane's own control plane is exactly the change that must not pass unnoticed. The safety is not
  // the exclusion; it is `pull_request_target` plus checking out no head ref, both asserted above.
  it('IS in the guarded set once it provides a required context, and that is safe', () => {
    const { workflows } = readGuardedWorkflows(ROOT);
    expect(workflows).toContain(GATE_RELATIVE);
    // The two properties that make self-guarding safe rather than circular. If either regressed, the
    // inclusion above would become the exposure the old assertion feared.
    expect(GATE).toMatch(/^on:\n\s{2}pull_request_target:/m);
    expect(STEPS).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/);
  });
});

describe('the scan behaviour this gate depends on', () => {
  /*
   * Asserted HERE, beside the workflow, and not only in the scan's own test file. The gate's whole
   * design rests on judging a change from a checkout that is NOT that change: it holds the BASE and
   * asks about a fetched `FETCH_HEAD`. A scan that always diffed `HEAD` would compare the base
   * against itself, find nothing, and report a clean verdict from the wrong tree — a green that
   * measured nothing, produced by the gate built to stop exactly that.
   *
   * Real history rather than a fixture, because the property is what the `git diff` range does and a
   * stubbed git would be asserting the stub.
   */
  const TOUCHED_CI = '024ca7128dda01e5470b14eb27aeaa3bc65a1995';

  it('reports a guarded workflow touched by the NAMED head', () => {
    const { findings } = findWorkflowProvenanceFindings(ROOT, `${TOUCHED_CI}~1`, TOUCHED_CI);
    expect(findings.map((f) => f.file)).toContain('.github/workflows/ci.yml');
  });

  it('reports nothing when the named head IS the base, rather than falling back to HEAD', () => {
    // The case that fails if the head stops being an argument: with `HEAD` hardcoded, this range
    // becomes "the base against the working tree" and picks up whatever that touched.
    const { findings } = findWorkflowProvenanceFindings(ROOT, `${TOUCHED_CI}~1`, `${TOUCHED_CI}~1`);
    expect(findings).toEqual([]);
  });
});
