/**
 * D9 / INFRA-060 — the workflow permission surface cannot widen unnoticed.
 *
 * Each rule is tested on its own, because either alone is a plausible-looking guard that leaves the
 * other hole open. `scan-main-required-checks` shipped green on three variants of its own target
 * defect, and `HARNESS-052`'s guard shipped with three instances of the class it audited — both
 * because the halves were only ever exercised together.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  examinedWriteScopeCount,
  findWorkflowPermissionFindings,
  JUSTIFIED_JOB_WRITE_SCOPES,
  JUSTIFIED_WRITE_SCOPES,
  parseJobPermissions,
  parsePermissions,
} from '../scan-workflow-permissions.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCAN_SCRIPT_PATH = path.resolve(import.meta.dirname, '../scan-workflow-permissions.mjs');

/** A throwaway repo root holding only `.github/workflows`, so fixtures cannot touch the real tree. */
function makeRoot(workflows) {
  const root = makeTemp('wf-perms-');
  const dir = path.join(root, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return root;
}

let roots = [];
beforeEach(() => {
  roots = [];
});
afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
function root(workflows) {
  const created = makeRoot(workflows);
  roots.push(created);
  return created;
}

describe('parsePermissions', () => {
  it('returns null when the workflow declares no block — it inherits the repo default', () => {
    expect(parsePermissions('name: x\non:\n  push:\n')).toBeNull();
  });

  it('reads a block and stops at the next top-level key', () => {
    const source = 'permissions:\n  contents: read\n  id-token: write\n\nenv:\n  A: b\n';
    expect(parsePermissions(source)).toEqual({ contents: 'read', 'id-token': 'write' });
  });

  /**
   * Regression: the first draft took the LAST value on a duplicate key, so `write` above `read`
   * parsed as `read` and the unjustified-scope RED case silently did not fire. Duplicate keys are
   * invalid YAML and GitHub rejects them, so this cannot mask a real config — but a scan that
   * under-reports its own subject is the defect this whole sweep is about.
   */
  it('takes the WIDEST level on a duplicate key, not the last', () => {
    expect(parsePermissions('permissions:\n  contents: write\n  contents: read\n')).toEqual({
      contents: 'write',
    });
    expect(parsePermissions('permissions:\n  contents: read\n  contents: write\n')).toEqual({
      contents: 'write',
    });
  });
});

describe('rule 1 — a write scope must be justified', () => {
  it('RED: an unjustified write grant is a finding', () => {
    const findings = findWorkflowPermissionFindings(
      root({ 'unknown.yml': 'permissions:\n  contents: write\n' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/no justification/);
  });

  it('GREEN: read-only workflows and undeclared blocks are not findings', () => {
    const findings = findWorkflowPermissionFindings(
      root({
        'a.yml': 'permissions:\n  contents: read\n',
        'b.yml': 'name: no block here\non:\n  push:\n',
      }),
    );
    expect(findings).toEqual([]);
  });
});

describe('rule 2 — anti-rot: a justification cannot outlive its scope', () => {
  it('RED: an entry nobody requests is a finding', () => {
    // `codeql.yml` is justified for `security-events: write`; a fixture that drops the grant must
    // leave the excuse dangling.
    const findings = findWorkflowPermissionFindings(
      root({ 'codeql.yml': 'permissions:\n  contents: read\n' }),
    );
    expect(findings.some((finding) => /still excuses/.test(finding.detail))).toBe(true);
  });
});

describe('fail-closed — the scan never passes over nothing', () => {
  it('a missing workflow directory is a finding, not a pass', () => {
    const empty = makeTemp('wf-perms-empty-');
    roots.push(empty);
    const findings = findWorkflowPermissionFindings(empty);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/examined nothing/);
  });

  it('an empty workflow directory is a finding, not a pass', () => {
    const findings = findWorkflowPermissionFindings(root({}));
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/examined nothing/);
  });
});

describe('the real repository', () => {
  it('holds — every declared write scope is justified and every justification is live', () => {
    expect(findWorkflowPermissionFindings(REPO_ROOT)).toEqual([]);
  });

  it('the justification table is non-empty, so the green above is not vacuous', () => {
    const total = Object.values(JUSTIFIED_WRITE_SCOPES).reduce(
      (sum, scopes) => sum + Object.keys(scopes).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it('the JOB-level justification table is non-empty (the real repo has job-level grants)', () => {
    const total = Object.values(JUSTIFIED_JOB_WRITE_SCOPES).reduce(
      (sum, jobs) =>
        sum + Object.values(jobs).reduce((jt, scopes) => jt + Object.keys(scopes).length, 0),
      0,
    );
    expect(total).toBeGreaterThan(0);
  });
});

describe('parseJobPermissions (HARNESS-082)', () => {
  const withJob = (jobBlock) =>
    `name: x\non:\n  push:\npermissions:\n  contents: read\njobs:\n${jobBlock}`;

  it('reads a job-level block and returns it keyed by job id', () => {
    const source = withJob(
      '  build:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n      actions: write\n    steps:\n      - run: true\n',
    );
    expect(parseJobPermissions(source)).toEqual({ build: { contents: 'read', actions: 'write' } });
  });

  it('omits a job that declares no permissions block (it inherits the workflow level)', () => {
    const source = withJob('  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n');
    expect(parseJobPermissions(source)).toEqual({});
  });

  it('reads more than one job, and stops at the next top-level key', () => {
    const source =
      withJob(
        '  a:\n    permissions:\n      actions: write\n  b:\n    permissions:\n      pull-requests: write\n',
      ) + 'env:\n  X: y\n';
    expect(parseJobPermissions(source)).toEqual({
      a: { actions: 'write' },
      b: { 'pull-requests': 'write' },
    });
  });

  it('catches an inline `permissions: write-all` as a broad write grant', () => {
    const source = withJob('  broad:\n    permissions: write-all\n    steps:\n      - run: true\n');
    expect(parseJobPermissions(source)).toEqual({ broad: { all: 'write' } });
  });

  it('parses an inline flow-mapping `permissions: {contents: write}` — no syntax blind spot', () => {
    const source = withJob(
      '  flow:\n    permissions: { contents: write, actions: read }\n    steps:\n      - run: true\n',
    );
    expect(parseJobPermissions(source)).toEqual({ flow: { contents: 'write', actions: 'read' } });
  });

  it('does NOT read a step input `with: permissions:` block as the job grant (#1680 review)', () => {
    // A step input `with: permissions:` (e.g. actions/create-github-app-token's app-token scopes)
    // is nested deeper than the job's own direct children. It is not the job's GITHUB_TOKEN grant,
    // so reading it as one raises a spurious finding. The job here has NO real permissions block —
    // only a step whose `with:` carries a permissions block, at a deeper indent.
    const source = withJob(
      '  build:\n    runs-on: ubuntu-latest\n    steps:\n' +
        '      - uses: actions/create-github-app-token@v1\n' +
        '        with:\n          permissions:\n            contents: write\n',
    );
    expect(parseJobPermissions(source)).toEqual({});
  });
});

describe('job-level write grants are held to JUSTIFIED_JOB_WRITE_SCOPES (HARNESS-082)', () => {
  it('flags a job-level write grant that no allowlist entry justifies', () => {
    const src =
      'name: x\non:\n  push:\njobs:\n  sneaky:\n    permissions:\n      contents: write\n    steps:\n      - run: true\n';
    const findings = findWorkflowPermissionFindings(root({ 'x.yml': src }));
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/job `sneaky` grants `contents: write`/);
  });

  it('passes a job-level write grant that IS justified, and counts it as examined', () => {
    // Review Gate's analyzer owns the PR SARIF upload in the same workflow DAG.
    const src = `name: x
on:
  pull_request:
jobs:
  analyze:
    permissions:
      security-events: write
    steps:
      - run: true
  review-gate:
    permissions:
      pull-requests: write
    steps:
      - run: true
  disarm-auto-merge:
    permissions:
      contents: write
      pull-requests: write
    steps:
      - run: true
`;
    const findings = findWorkflowPermissionFindings(root({ 'review-gate.yml': src }));
    expect(findings).toEqual([]);
    expect(examinedWriteScopeCount()).toBe(4);
  });

  it('flags a STALE job-level excuse the job no longer requests (anti-rot)', () => {
    const src = 'name: x\non:\n  pull_request:\njobs:\n  analyze:\n    steps:\n      - run: true\n';
    const findings = findWorkflowPermissionFindings(root({ 'review-gate.yml': src }));
    expect(findings.some((f) => /still excuses job `analyze`/.test(f.detail))).toBe(true);
  });
});

describe('the examined count is what was read, not what was declared', () => {
  /**
   * The declaration table keeps an entry for a workflow that has since been deleted, and the
   * anti-rot loop skips those. Reporting the table's size as the examined count therefore claims a
   * number larger than what was examined — the exact defect the `::examined::` line exists to
   * expose, committed by the change that introduced the line. Review caught it.
   */
  it('counts only the write scopes present on disk', () => {
    const tree = root({
      'a.yml':
        'on:\n  push:\npermissions:\n  contents: write\njobs:\n  x:\n    runs-on: ubuntu-latest\n',
    });

    findWorkflowPermissionFindings(tree);

    expect(examinedWriteScopeCount(), 'a scope on disk was not counted').toBe(1);
  });

  it('reports zero when the governed tree holds no write scope at all', () => {
    // And zero is exactly what the runner refuses to accept as a silent pass.
    const tree = root({
      'a.yml':
        'on:\n  push:\npermissions:\n  contents: read\njobs:\n  x:\n    runs-on: ubuntu-latest\n',
    });

    findWorkflowPermissionFindings(tree);

    expect(examinedWriteScopeCount()).toBe(0);
  });

  it('declares WHY a zero is correct, so a clean read-only tree cannot redden the suite', () => {
    // Every workflow granting only `read` is the state this scan exists to move toward: it returns
    // no findings and examines no write scope. An UNDECLARED zero is a hard failure in the runner,
    // so the line must carry its reason or the suite goes red over a tree the scan calls clean.
    const tree = root({
      'a.yml':
        'on:\n  push:\npermissions:\n  contents: read\njobs:\n  x:\n    runs-on: ubuntu-latest\n',
    });

    expect(findWorkflowPermissionFindings(tree)).toEqual([]);
    expect(examinedWriteScopeCount()).toBe(0);

    // The script resolves its workspace root from its own location, not from `cwd`, so it has to be
    // copied INTO the fixture — running it in place would read the real repository and assert
    // nothing about this tree. It has no local imports, so the copy is the whole dependency.
    // ...and at the depth it expects: it resolves the workspace root as `../..` from its own
    // directory, so a copy dropped at the fixture root would judge the fixture's PARENT. Placed a
    // level too high, it reported "the workflow directory does not exist" over a tree that has one.
    const copied = path.join(tree, 'scripts/harness/scan-workflow-permissions.mjs');
    fs.mkdirSync(path.dirname(copied), { recursive: true });
    fs.copyFileSync(SCAN_SCRIPT_PATH, copied);
    const printed = execFileSync('node', [copied], { cwd: tree, encoding: 'utf8' });
    expect(printed, 'a clean zero was printed with no reason attached').toMatch(
      /::examined:: 0 write scopes ::expected-empty::/,
    );
  });

  it('reports zero after a run that bailed on an absent workflow directory', () => {
    // The reset must run BEFORE the early returns, not after them: those paths are exactly the ones
    // that examined nothing, so a holder reset after them reports the previous run's number for the
    // very case that looked at zero. Review caught this in the change that added the property.
    const withScope = root({
      'a.yml':
        'on:\n  push:\npermissions:\n  contents: write\njobs:\n  x:\n    runs-on: ubuntu-latest\n',
    });
    const noWorkflowDir = makeTemp('wf-perms-bare-');
    roots.push(noWorkflowDir);

    findWorkflowPermissionFindings(withScope);
    findWorkflowPermissionFindings(noWorkflowDir);

    expect(examinedWriteScopeCount(), 'a run that read no directory kept the previous count').toBe(
      0,
    );
  });

  it("does not carry a previous run's count into the next", () => {
    // A module-level holder that is never reset reports the largest run it ever saw.
    const withScope = root({
      'a.yml':
        'on:\n  push:\npermissions:\n  contents: write\njobs:\n  x:\n    runs-on: ubuntu-latest\n',
    });
    const without = root({
      'a.yml':
        'on:\n  push:\npermissions:\n  contents: read\njobs:\n  x:\n    runs-on: ubuntu-latest\n',
    });

    findWorkflowPermissionFindings(withScope);
    findWorkflowPermissionFindings(without);

    expect(examinedWriteScopeCount(), 'the count survived into a run that read nothing').toBe(0);
  });
});

describe('scans-full.yml is justified where it asks for issues: write (PROC-016)', () => {
  it('names the job scope with a reason, and the live tree reports no finding for it', () => {
    const entry = JUSTIFIED_JOB_WRITE_SCOPES['scans-full.yml']?.['scans-full'];
    expect(typeof entry?.issues).toBe('string');
    expect(entry.issues.length).toBeGreaterThan(20);
    const findings = findWorkflowPermissionFindings();
    expect(findings.filter((f) => JSON.stringify(f).includes('scans-full'))).toEqual([]);
  });
});

describe('ci.yml PR-free review benchmark justifies its CodeQL upload permission', () => {
  it('records why benchmark-review-gate needs security-events: write', () => {
    const entry = JUSTIFIED_JOB_WRITE_SCOPES['ci.yml']?.['benchmark-review-gate'];
    expect(entry?.['security-events']).toMatch(/PR-free benchmark CodeQL SARIF analysis/);

    const findings = findWorkflowPermissionFindings(REPO_ROOT);
    expect(
      findings.filter(
        (finding) =>
          finding.file === 'ci.yml' && JSON.stringify(finding).includes('benchmark-review-gate'),
      ),
    ).toEqual([]);
  });
});
