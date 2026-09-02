// TEST-011: the complete harness test directory must remain covered by the canonical tier owner.
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

    expect(content).toContain(`'scripts/harness/__tests__'`);
  });

  it('verify-change uses the bounded thread pool', () => {
    const content = read('scripts/harness/verify-change.mjs');

    expect(content).toContain("'--pool=threads'");
    expect(content).toContain("'--maxWorkers=2'");
    expect(content).toContain("'--testTimeout=30000'");
  });

  it('verify-change never enumerates individual harness test files', () => {
    const content = read('scripts/harness/verify-change.mjs');

    // A hardcoded `scripts/harness/__tests__/<file>.test.mjs` argument is exactly the
    // drift that hid the stale conformance test. The runner must reference the
    // directory only.
    expect(content).not.toMatch(/scripts\/harness\/__tests__\/[\w.-]+\.test\.mjs/);
  });

  it('root harness:test delegates the complete run to the canonical tier owner', () => {
    const packageJson = JSON.parse(read('package.json'));
    const script = packageJson.scripts?.['harness:test'];

    expect(script).toBeTypeOf('string');
    expect(script).toContain('harness-test-tiers.mjs --tier contracts');
    expect(script).toContain('harness-test-tiers.mjs --verify-hermetic-stripped');
    expect(script).not.toContain('harness-test-tiers.mjs --tier all');
    expect(script).not.toMatch(/\.test\.mjs/);
    const owner = read('scripts/harness/harness-test-tiers.mjs');
    expect(owner).toContain(`const TEST_DIR = '${HARNESS_TESTS_DIR}'`);
    expect(owner).toContain("entry.name.endsWith('.test.mjs')");
  });

  it('root harness:test uses the bounded thread pool', () => {
    const packageJson = JSON.parse(read('package.json'));
    const script = read('scripts/harness/harness-test-tiers.mjs');

    expect(script).toContain('--pool=threads');
    expect(script).toContain('--maxWorkers=2');
    expect(script).toContain('--testTimeout=30000');
  });
});

describe('globbed harness suite is gated in CI and pre-push (TEST-011)', () => {
  it('CI runs affected contracts and gates only the hermetic tier on the develop path', () => {
    const content = read('.github/workflows/ci.yml');
    const stepIndex = content.indexOf(
      'Harness affected verification (concurrent, dist-independent)',
    );

    expect(stepIndex).toBeGreaterThanOrEqual(0);

    const stepBlock = content.slice(stepIndex, stepIndex + 1_800);
    expect(stepBlock).toContain('pnpm harness:test:contracts:affected');
    expect(stepBlock).toContain('pnpm harness:test:hermetic');
    expect(stepBlock).toContain("needs.changes.result != 'success'");

    const scansHeader = content.slice(
      content.indexOf('\n  scans:\n'),
      content.indexOf('steps:', content.indexOf('\n  scans:\n')),
    );
    expect(scansHeader).toContain('!cancelled()');
    expect(scansHeader).toContain("github.base_ref != 'main'");
  });

  // INFRA-055: on a main PR the `scans` job no longer runs at all, so the release gate is the only
  // place the harness suite can run there — and it did not run it. `pnpm test` is
  // `pnpm run -r --if-present test`, which excludes the workspace root, so `harness:test` was
  // outside `harness:verify:release` entirely. Dropping `scans` from `protect-main`'s required list
  // is only safe because the release gate now runs the suite itself.
  it('release-grade verification runs the globbed harness suite too', () => {
    const packageJson = JSON.parse(read('package.json'));

    expect(packageJson.scripts?.['harness:verify:release']).toContain('pnpm harness:test');
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
