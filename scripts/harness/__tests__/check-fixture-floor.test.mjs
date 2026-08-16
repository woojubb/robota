import { describe, expect, it } from 'vitest';

import {
  findFixtureFloorFindings,
  listCheckModules,
  readExamined,
} from '../check-fixture-floor.mjs';

/** A fixture walk: two checks, one of which has no test file. */
const MODULES = ['check-alpha', 'scan-beta'];
const HAS = (covered) => (name) => covered.includes(name);

describe('check-fixture-floor (HARNESS-098) — RED direction', () => {
  it('fails a check that has no fixture test', () => {
    const findings = findFixtureFloorFindings({
      modules: MODULES,
      hasFixture: HAS(['check-alpha']),
      baseline: [],
    });
    expect(findings.some((f) => /^scan-beta: no fixture test/.test(f))).toBe(true);
  });

  it('fails a baselined entry that has since gained a fixture, so the gain is locked in', () => {
    const findings = findFixtureFloorFindings({
      modules: MODULES,
      hasFixture: HAS(['check-alpha', 'scan-beta']),
      baseline: ['scan-beta'],
    });
    expect(findings.some((f) => /still baselined/.test(f))).toBe(true);
  });

  it('fails a baseline entry naming a check that no longer exists', () => {
    const findings = findFixtureFloorFindings({
      modules: MODULES,
      hasFixture: HAS(MODULES),
      baseline: ['check-deleted-long-ago'],
    });
    expect(findings.some((f) => /no such check\/scan exists/.test(f))).toBe(true);
  });
});

describe('check-fixture-floor (HARNESS-098) — GREEN direction', () => {
  it('passes when every check has a fixture', () => {
    expect(
      findFixtureFloorFindings({ modules: MODULES, hasFixture: HAS(MODULES), baseline: [] }),
    ).toHaveLength(0);
  });

  it('passes an uncovered check that is explicitly baselined', () => {
    expect(
      findFixtureFloorFindings({
        modules: MODULES,
        hasFixture: HAS(['check-alpha']),
        baseline: ['scan-beta'],
      }),
    ).toHaveLength(0);
  });

  it('reports the size of what it examined, reset per walk', () => {
    findFixtureFloorFindings({ modules: MODULES, hasFixture: HAS(MODULES), baseline: [] });
    expect(readExamined()).toBe(2);
    findFixtureFloorFindings({ modules: ['check-only'], hasFixture: HAS([]), baseline: [] });
    expect(readExamined()).toBe(1);
  });
});

describe('check-fixture-floor (HARNESS-098) — the real tree', () => {
  it('discovers the repository’s own check/scan modules', () => {
    const modules = listCheckModules();
    expect(modules.length).toBeGreaterThan(100);
    expect(modules).toContain('check-agent-def-convention');
  });

  it('covers itself — the floor applies to the file that enforces it', () => {
    expect(listCheckModules()).toContain('check-fixture-floor');
  });
});
