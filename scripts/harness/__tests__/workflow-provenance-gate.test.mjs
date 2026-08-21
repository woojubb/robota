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
});

describe('and never runs the pull request it is judging', () => {
  it('checks out no explicit ref, so the base is what lands in the working tree', () => {
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

  it('is NOT itself in the guarded set, which would be circular', () => {
    // If this file provided a required check, it would guard itself — and a change editing it would
    // be judged by the edited version, which is the exposure one level up.
    const { workflows } = readGuardedWorkflows(ROOT);
    expect(workflows).not.toContain(GATE_RELATIVE);
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
