import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

import {
  findRequiredCheckNeedsFindings,
  isFailSafeFor,
  jobContextName,
  JOB_STATUS_FUNCTION,
} from '../scan-required-check-needs.mjs';

/**
 * `scan-main-required-checks` originally shipped GREEN on three variants of the very defect it
 * was written for, because its rule was a blacklist of the one spelling its author had seen.
 * These cases exist so this scan does not repeat that: each HALF of the fail-safe rule is tested
 * on its own, because either half alone is a plausible "fix" that leaves the bypass wide open.
 */
describe('isFailSafeFor', () => {
  const dependency = 'changes';

  it('accepts the shipped fail-safe shape', () => {
    expect(
      isFailSafeFor(
        "${{ !cancelled() && github.base_ref != 'main' && (needs.changes.result != 'success' || needs.changes.outputs.code == 'true') }}",
        dependency,
      ),
    ).toBe(true);
  });

  it('rejects the PRE-FIX shape that let #1424 merge on three `skipping` required checks', () => {
    expect(
      isFailSafeFor(
        "github.base_ref != 'main' && needs.changes.outputs.code == 'true'",
        dependency,
      ),
    ).toBe(false);
  });

  it('rejects `needs.<dep>.result` WITHOUT a job-status function', () => {
    // Half-fix #1: GitHub skips the job before this expression is ever evaluated, so naming the
    // dependency's result here changes nothing at all.
    expect(isFailSafeFor("needs.changes.result != 'success'", dependency)).toBe(false);
  });

  it('rejects a job-status function WITHOUT `needs.<dep>.result`', () => {
    // Half-fix #2: the job now runs when `changes` fails, but the condition still reads only
    // `outputs.code`, which is EMPTY on a failed job — so it evaluates false and the job skips
    // anyway. Green scan, unchanged bypass.
    expect(isFailSafeFor("!cancelled() && needs.changes.outputs.code == 'true'", dependency)).toBe(
      false,
    );
  });

  it('rejects an absent condition', () => {
    expect(isFailSafeFor(undefined, dependency)).toBe(false);
    expect(isFailSafeFor('', dependency)).toBe(false);
  });

  it('does not accept a fail-safe written for a DIFFERENT dependency', () => {
    expect(isFailSafeFor("!cancelled() && needs.build.result != 'success'", dependency)).toBe(
      false,
    );
  });

  it('accepts `always()` and `failure()` as job-status functions', () => {
    expect(isFailSafeFor("always() && needs.changes.result != 'skipped'", dependency)).toBe(true);
    expect(isFailSafeFor("failure() || needs.changes.result == 'success'", dependency)).toBe(true);
  });

  it('does not mistake a bare word for a job-status function call', () => {
    expect(JOB_STATUS_FUNCTION.test('alwaysRun && needs.changes.result')).toBe(false);
    expect(JOB_STATUS_FUNCTION.test('always()')).toBe(true);
    expect(JOB_STATUS_FUNCTION.test('!cancelled( )')).toBe(true);
  });
});

describe('jobContextName', () => {
  it('prefers the declared `name:` over the job id, because branch protection matches the name', () => {
    expect(jobContextName('dependency-audit', '    name: dependency audit\n    steps:\n')).toBe(
      'dependency audit',
    );
  });

  it('falls back to the job id when no name is declared', () => {
    expect(jobContextName('changes', '    runs-on: ubuntu-latest\n')).toBe('changes');
  });

  it('strips quotes so a quoted name still matches the declared context', () => {
    expect(jobContextName('x', "    name: 'patch-coverage (advisory)'\n")).toBe(
      'patch-coverage (advisory)',
    );
  });
});

describe('the scan itself, not only its helpers', () => {
  // Found by a harness audit: every case here tested `isFailSafeFor` and `jobContextName` and none
  // ever called the finder. Both helpers can be right while the scan reports nothing — a check whose
  // only proof is of its parts has not been shown to fail at all, which is the property that decides
  // whether it is worth keeping.
  const scratch = [];
  afterAll(() => {
    while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
  });

  /** A root carrying the real required-check declaration and nothing else. */
  function rootWithDeclarationOnly() {
    const root = makeTemp('required-check-needs-');
    scratch.push(root);
    mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    writeFileSync(
      path.join(root, '.github/required-status-checks.json'),
      readFileSync(path.join(WORKSPACE_ROOT, '.github/required-status-checks.json'), 'utf8'),
    );
    return root;
  }

  it('reports every required check whose workflow it cannot read', () => {
    const { findings, edges } = findRequiredCheckNeedsFindings(rootWithDeclarationOnly());

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.detail).toMatch(/does not exist/);
    // And it says it examined nothing, so the absence cannot read as a clean pass.
    expect(edges).toBe(0);
  });

  it('REFUSES a root with no declaration rather than reporting it clean', () => {
    const bare = makeTemp('required-check-needs-bare-');
    scratch.push(bare);

    expect(() => findRequiredCheckNeedsFindings(bare)).toThrow(/required-status-checks\.json/);
  });

  /** A root carrying one hand-written branch declaration and the given workflow files. */
  function rootWith(workflows, contexts) {
    const root = makeTemp('required-check-needs-fixture-');
    scratch.push(root);
    mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    for (const [name, text] of Object.entries(workflows)) {
      writeFileSync(path.join(root, '.github/workflows', name), text);
    }
    writeFileSync(
      path.join(root, '.github/required-status-checks.json'),
      JSON.stringify({ branches: { main: { required_status_checks: contexts } } }),
    );
    return root;
  }

  it('reports the shape `scan-main-required-checks` R6 used to own', () => {
    // R6 asserted this on `main` only. It came here when the audit measured it down to zero live
    // subjects; the case moved with the rule so its red did not end with it. RAN against this scan
    // BEFORE R6 was deleted: 1 edge, 1 finding.
    const root = rootWith(
      {
        'ci.yml': `on:
  pull_request:
jobs:
  gate:
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
`,
      },
      [
        {
          context: 'release-grade verification',
          workflow: '.github/workflows/ci.yml',
          job: 'release-grade-verify',
        },
      ],
    );

    const { findings, edges } = findRequiredCheckNeedsFindings(root);

    expect(edges).toBe(1);
    expect(findings[0]?.detail).toMatch(/NOT a required check on `main`/);
  });

  it('reports a `needs:` naming a job that workflow does not declare', () => {
    // The one case `scan-main-required-checks`'s R6 held that this scan did not, and the reason
    // the guard had to land BEFORE R6 was removed. `needs:` resolves within the job's OWN
    // workflow, but the fallback `dependencyContext = need` compared the raw job id against the
    // required-context names — so a `needs:` on a job absent from this file was indistinguishable
    // from a satisfied dependency whenever some OTHER workflow published a required context of
    // the same name. The edge then took the early `continue` and reported clean.
    //
    // It is not clean. GitHub refuses the whole workflow for an unresolvable `needs:`, so the
    // required check never reports at all — the shape #1436 rolled back for.
    const root = rootWith(
      {
        'ci.yml': `on:
  pull_request:
jobs:
  release-grade-verify:
    name: release-grade verification
    runs-on: ubuntu-latest
    needs: gate
    steps:
      - run: pnpm harness:verify:release
`,
        // `gate` is a required context — but published from a DIFFERENT workflow, so its own
        // declaration entry resolves and only the dangling edge above is left to catch.
        'gate.yml': `on:
  pull_request:
jobs:
  gate:
    name: gate
    runs-on: ubuntu-latest
    steps:
      - run: echo gate
`,
      },
      [
        {
          context: 'release-grade verification',
          workflow: '.github/workflows/ci.yml',
          job: 'release-grade-verify',
        },
        { context: 'gate', workflow: '.github/workflows/gate.yml', job: 'gate' },
      ],
    );

    const { findings, edges } = findRequiredCheckNeedsFindings(root);

    expect(edges).toBe(1);
    expect(findings.map((finding) => finding.detail).join('\n')).toMatch(
      /needs `gate`, which no job in/,
    );
  });
});
