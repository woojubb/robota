import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  EXCLUSIONS,
  classifyTestScripts,
  collectTestScripts,
  referencedEntryFile,
} from '../release-test-suites.mjs';
import {
  findReleaseSweepCoverageFindings,
  namesExplicitly,
  sweepsRecursively,
} from '../scan-release-sweep-coverage.mjs';

/**
 * Findings a FIXTURE root can meaningfully produce.
 *
 * R3's anti-rot half asks "does every live exclusion still match a real script", which is a question
 * about THIS repository — a fixture root declaring three packages naturally fails it for the eight
 * exclusions it does not reproduce. Filtering that class keeps each fixture case about the rule it
 * was written for; the anti-rot rule itself is asserted against the live tree at the bottom of this
 * file, where it means something.
 */
const onFixture = (root) =>
  findReleaseSweepCoverageFindings(root).filter((f) => f.type !== 'stale-exclusion');

/**
 * Fixture roots, not the live tree. The live tree is GREEN by construction now, so asserting
 * against it would only prove the scan agrees with the state that produced it — the accidental
 * green this repository has been bitten by repeatedly. Every case below builds the defect first.
 */
const roots = [];

function makeRoot(files) {
  const root = makeTemp('release-sweep-');
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  }
  return root;
}

const WORKSPACE_YAML = "packages:\n  - 'packages/*'\n  - 'apps/*'\n";

/** A root whose only quirk is the one each test introduces. */
function baseRoot(overrides = {}) {
  return makeRoot({
    'pnpm-workspace.yaml': WORKSPACE_YAML,
    'package.json': {
      scripts: {
        test: 'pnpm run -r --if-present test',
        'harness:verify:release':
          'pnpm test && node scripts/harness/release-test-suites.mjs && pnpm lint',
      },
    },
    'packages/alpha/package.json': {
      name: '@fixture/alpha',
      scripts: { test: 'vitest run' },
    },
    ...overrides,
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('R2 reachability — the pre-fix, hand-maintained shape', () => {
  /**
   * THE RED PROOF this scan exists to survive. Before it landed, the release script reached
   * `agent-cli`'s `test:bin` through a literal `pnpm --filter @robota-sdk/agent-cli test:bin`
   * someone had appended by hand — the one instance of the defect the repository had noticed. Drop
   * that literal and the suite becomes unreachable in complete silence, because
   * `pnpm run -r --if-present test` never matches a script called `test:bin`.
   *
   * Run against the real tree during development, this is exactly what the scan printed.
   */
  const handMaintained = (releaseScript) => ({
    'package.json': {
      scripts: { test: 'pnpm run -r --if-present test', 'harness:verify:release': releaseScript },
    },
    'packages/cli/package.json': {
      name: '@fixture/cli',
      scripts: { test: 'vitest run', 'test:bin': 'vitest run --config vitest.bin.config.ts' },
    },
    'packages/cli/vitest.bin.config.ts': 'export default {};',
  });

  it('goes RED when the hand-written `--filter` line is dropped', () => {
    const root = baseRoot(handMaintained('pnpm test && pnpm lint'));
    const findings = onFixture(root);
    expect(findings.map((f) => f.subject)).toContain('packages/cli#test:bin');
  });

  it('is GREEN while the hand-written `--filter` line is still there', () => {
    // The pre-fix shape was not WRONG, it was unmaintainable. The scan has to accept it, or the
    // red proof above would only be showing that it dislikes the old spelling.
    const root = baseRoot(
      handMaintained('pnpm test && pnpm --filter @fixture/cli test:bin && pnpm lint'),
    );
    expect(onFixture(root)).toEqual([]);
  });

  it('is GREEN when the enumerating runner is wired instead, with no package named anywhere', () => {
    const root = baseRoot(
      handMaintained('pnpm test && node scripts/harness/release-test-suites.mjs && pnpm lint'),
    );
    expect(onFixture(root)).toEqual([]);
  });

  it('goes RED when the recursive sweep itself is removed', () => {
    const root = baseRoot({
      'package.json': {
        scripts: {
          test: 'pnpm run -r --if-present test',
          'harness:verify:release': 'node scripts/harness/release-test-suites.mjs && pnpm lint',
        },
      },
    });
    expect(onFixture(root)[0].subject).toBe('harness:verify:release');
  });
});

describe('R0 vacuity', () => {
  it('fails when it discovers no test scripts at all, rather than reporting a complete sweep', () => {
    const root = baseRoot({
      'packages/alpha/package.json': { name: '@fixture/alpha', scripts: { build: 'tsc' } },
    });
    const findings = onFixture(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].subject).toBe('workspace');
  });

  it('throws on a root with no workspace declaration instead of enumerating zero manifests', () => {
    // Pinned in `scan-guard-scope-fail-closed`'s MANDATORY_TREE_GUARDS on this behaviour. A
    // coverage floor that reported a pass over a tree it never read would be the audited defect.
    const bare = makeTemp('release-sweep-bare-');
    roots.push(bare);
    expect(() => findReleaseSweepCoverageFindings(bare)).toThrow(/pnpm-workspace\.yaml is missing/);
  });
});

describe('R1 completeness', () => {
  it('reports a `test:*` script that is neither run nor excluded', () => {
    const root = baseRoot({
      'packages/beta/package.json': {
        name: '@fixture/beta',
        scripts: { 'test:smoke': 'vitest run' },
      },
    });
    // The runner is wired, so it would RUN this suite — hence no R2 finding and no R1 finding
    // either. Unclassified means unrunnable, which is the case below.
    expect(onFixture(root)).toEqual([]);
    expect(classifyTestScripts(root).extra.map((e) => e.script)).toContain('test:smoke');
  });
});

describe('R3 exclusion integrity', () => {
  it('rejects a `sweep-variant` in a workspace that declares no plain `test`', () => {
    // The exact way an exclusion list rots into an allowlist: a workspace whose ONLY suite is
    // called `test:coverage` would be excluded as a "duplicate" of a suite that does not exist.
    const root = baseRoot({
      'packages/gamma/package.json': {
        name: '@fixture/gamma',
        scripts: { 'test:coverage': 'vitest run --coverage' },
      },
    });
    const findings = onFixture(root);
    expect(findings.map((f) => f.type)).toContain('variant-without-base');
    expect(findings.map((f) => f.subject)).toContain('packages/gamma#test:coverage');
  });

  it('rejects a `covered-elsewhere` claim whose workflow does not invoke the suite', () => {
    // Simulated by pointing the live `test:pty` exclusion at a workflow that says nothing about it.
    const exclusion = EXCLUSIONS.find((e) => e.script === 'test:pty');
    const root = baseRoot({
      'packages/agent-transport-tui/package.json': {
        name: '@robota-sdk/agent-transport-tui',
        scripts: { test: 'vitest run', 'test:pty': 'vitest run --config vitest.pty.config.ts' },
      },
      'packages/agent-transport-tui/vitest.pty.config.ts': 'export default {};',
      [exclusion.workflow]: 'jobs:\n  something-else:\n    runs-on: ubuntu-latest\n',
    });
    const findings = onFixture(root);
    expect(findings.map((f) => f.subject)).toContain('packages/agent-transport-tui#test:pty');
    expect(findings.map((f) => f.detail).join()).toMatch(/no invocation of/);
  });

  it('accepts the same claim when the workflow really invokes it', () => {
    const exclusion = EXCLUSIONS.find((e) => e.script === 'test:pty');
    const root = baseRoot({
      'packages/agent-transport-tui/package.json': {
        name: '@robota-sdk/agent-transport-tui',
        scripts: { test: 'vitest run', 'test:pty': 'vitest run --config vitest.pty.config.ts' },
      },
      'packages/agent-transport-tui/vitest.pty.config.ts': 'export default {};',
      [exclusion.workflow]:
        'jobs:\n  tui-e2e:\n    steps:\n      - run: pnpm --filter @robota-sdk/agent-transport-tui test:pty\n',
    });
    expect(onFixture(root)).toEqual([]);
  });
});

describe('R4 liveness', () => {
  /**
   * The live defect INFRA-063 was filed over. `packages/agent-cli-web` declared
   * `"test:e2e": "node e2e/run-smoke.mjs"`; `packages/agent-cli-web/e2e/` has never existed in this
   * repository's history and the script fails MODULE_NOT_FOUND. A hand-maintained release list
   * cannot notice this — it only knows what someone remembered to write down — so INFRA-060 D7 read
   * it as a maintained suite the gate was skipping, and adding it to a REQUIRED gate would have
   * turned every promotion red.
   */
  it('reports a test script whose entry file does not exist', () => {
    const root = baseRoot({
      'packages/web/package.json': {
        name: '@fixture/web',
        scripts: { 'test:e2e': 'node e2e/run-smoke.mjs' },
      },
    });
    const findings = onFixture(root);
    expect(findings.map((f) => f.subject)).toContain('packages/web#test:e2e');
    expect(findings.map((f) => f.detail).join()).toMatch(/does not exist/);
  });

  it('accepts the same script once the entry file is there', () => {
    const root = baseRoot({
      'packages/web/package.json': {
        name: '@fixture/web',
        scripts: { 'test:e2e': 'node e2e/run-smoke.mjs' },
      },
      'packages/web/e2e/run-smoke.mjs': '// smoke\n',
    });
    expect(onFixture(root)).toEqual([]);
  });

  it('sees through a wrapper command and a --config flag', () => {
    expect(referencedEntryFile('xvfb-run -a node e2e/run-e2e.mjs')).toBe('e2e/run-e2e.mjs');
    expect(referencedEntryFile('vitest run --config vitest.bin.config.ts')).toBe(
      'vitest.bin.config.ts',
    );
    expect(referencedEntryFile('vitest run')).toBeUndefined();
    expect(referencedEntryFile('jest --ci --coverage')).toBeUndefined();
  });
});

describe('reachability predicates', () => {
  it('does not mistake `test` for `test:bin` in either direction', () => {
    // `\b` alone would let `pnpm run -r --if-present test` satisfy a claim about `test:bin`.
    expect(sweepsRecursively('pnpm run -r --if-present test', 'test')).toBe(true);
    expect(namesExplicitly('pnpm --filter @a/b test:bin', '@a/b', 'test:bin')).toBe(true);
    expect(namesExplicitly('pnpm --filter @a/b run test:bin', '@a/b', 'test:bin')).toBe(true);
    expect(namesExplicitly('pnpm --filter @a/b test', '@a/b', 'test:bin')).toBe(false);
  });
});

describe('the live tree', () => {
  it('classifies every discovered test script exactly once', () => {
    const discovered = collectTestScripts();
    const { recursive, extra, excluded } = classifyTestScripts();
    expect(discovered.length).toBeGreaterThan(0);
    expect(recursive.length + extra.length + excluded.length).toBe(discovered.length);
  });

  it('is green', () => {
    expect(findReleaseSweepCoverageFindings()).toEqual([]);
  });

  it('reports a stale exclusion when one names a script no workspace declares', () => {
    // The anti-rot half, asserted where it means something. `packages/agent-cli-web` declaring a
    // dead `test:e2e` is how this item started; an exclusion outliving its script is the same
    // decay pointed the other way, and a table nobody re-checks is how it would go unnoticed.
    const root = makeRoot({
      'pnpm-workspace.yaml': WORKSPACE_YAML,
      'package.json': {
        scripts: {
          test: 'pnpm run -r --if-present test',
          'harness:verify:release': 'pnpm test && node scripts/harness/release-test-suites.mjs',
        },
      },
      'packages/alpha/package.json': { name: '@fixture/alpha', scripts: { test: 'vitest run' } },
    });
    const stale = findReleaseSweepCoverageFindings(root).filter(
      (f) => f.type === 'stale-exclusion',
    );
    expect(stale.length).toBe(EXCLUSIONS.length);
  });
});
