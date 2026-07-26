/**
 * D9 / INFRA-060 — the workflow permission surface cannot widen unnoticed.
 *
 * Each rule is tested on its own, because either alone is a plausible-looking guard that leaves the
 * other hole open. `scan-main-required-checks` shipped green on three variants of its own target
 * defect, and `HARNESS-052`'s guard shipped with three instances of the class it audited — both
 * because the halves were only ever exercised together.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findWorkflowPermissionFindings,
  JUSTIFIED_WRITE_SCOPES,
  parsePermissions,
} from '../scan-workflow-permissions.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** A throwaway repo root holding only `.github/workflows`, so fixtures cannot touch the real tree. */
function makeRoot(workflows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-perms-'));
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
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-perms-empty-'));
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
});
