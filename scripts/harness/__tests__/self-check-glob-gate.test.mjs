// TEST-011: the harness test suite must run as a DIRECTORY GLOB, gated in CI/pre-push.
//
// Defect class this fences (same as MOCK-001 hardcoded module mocks): an enumerated
// snapshot of a growing set, enforced nowhere. verify-change.mjs once ran a hardcoded
// list of 5 of 24+ harness test files, which let check-background-workspace-conformance
// sit failing (5/5 cases) unnoticed. The glob fix landed (INFRA-026) and CI now runs the
// whole directory (HARNESS-021) — this test makes those properties mechanical so they
// cannot silently regress.
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const HARNESS_TESTS_DIR = 'scripts/harness/__tests__';

function read(relativePath) {
  return readFileSync(relativePath, 'utf8');
}

describe('harness test suite runs as a glob, not an enumerated list (TEST-011)', () => {
  it('verify-change harness-tests check passes the whole __tests__ directory to vitest', () => {
    const content = read('scripts/harness/verify-change.mjs');

    expect(content).toContain(`['exec', 'vitest', 'run', '${HARNESS_TESTS_DIR}']`);
  });

  it('verify-change never enumerates individual harness test files', () => {
    const content = read('scripts/harness/verify-change.mjs');

    // A hardcoded `scripts/harness/__tests__/<file>.test.mjs` argument is exactly the
    // drift that hid the stale conformance test. The runner must reference the
    // directory only.
    expect(content).not.toMatch(/scripts\/harness\/__tests__\/[\w.-]+\.test\.mjs/);
  });

  it('root harness:test script runs vitest on the whole directory', () => {
    const packageJson = JSON.parse(read('package.json'));
    const script = packageJson.scripts?.['harness:test'];

    expect(script).toBeTypeOf('string');
    expect(script).toContain(`vitest run ${HARNESS_TESTS_DIR}`);
    expect(script).not.toMatch(/\.test\.mjs/);
  });
});

describe('globbed harness suite is gated in CI and pre-push (TEST-011)', () => {
  it('CI runs the full harness test suite on the develop-merge path', () => {
    const content = read('.github/workflows/ci.yml');
    const stepIndex = content.indexOf('Harness scan test suite');

    expect(stepIndex).toBeGreaterThanOrEqual(0);

    // The step must execute the directory-globbed script, on the develop path
    // (skipped only for main-targeted release PRs, which run release-grade
    // verification instead).
    const stepBlock = content.slice(stepIndex, stepIndex + 300);
    expect(stepBlock).toContain('pnpm harness:test');
    expect(stepBlock).toContain("github.base_ref != 'main'");
  });

  it('pre-push runs harness:verify, whose harness-tests check uses the globbed run', () => {
    const content = read('scripts/harness/pre-push.mjs');

    expect(content).toContain('harness:verify');
  });
});

describe('stale-conformance regression fixture stays inside the globbed directory (TEST-011)', () => {
  it('check-background-workspace-conformance test file exists where the glob picks it up', () => {
    // The original incident: this file failed 5/5 cases without anyone noticing
    // because the enumerated runner never executed it. Directory membership is what
    // guarantees the globbed run includes it.
    expect(existsSync(`${HARNESS_TESTS_DIR}/check-background-workspace-conformance.test.mjs`)).toBe(
      true,
    );
  });
});
