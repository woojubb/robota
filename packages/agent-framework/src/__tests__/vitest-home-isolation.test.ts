/**
 * The floor that keeps the workspace-wide home isolation honest (TEST-013, issue #2300).
 *
 * ## Why this file exists
 *
 * `vitest.shared.ts` points `HOME`/`USERPROFILE` at a created, empty, per-run directory so that no
 * test can be satisfied — or broken — by whatever the runner happens to have in `~/.claude`,
 * `~/.robota` or `~/.claude/skills`. That assignment lives in a config file, which no test executes.
 * Without an assertion taken INSIDE a test process, the isolation could be deleted, reordered or
 * quietly defeated by a runner change and every suite would keep reporting green.
 *
 * ## Why it asserts `homedir()` and not the pool
 *
 * `os.homedir()` follows `process.env.HOME` in a forked child and (as measured under TEST-012) not
 * necessarily in a worker thread. Asserting `pool === 'forks'` would pin today's mechanism and go
 * vacuous the moment the pool changes; asserting what `homedir()` actually returns pins the
 * PROPERTY, so a pool change that breaks the isolation turns this red instead of silently removing
 * it.
 *
 * ## Why the last two cases are a pair
 *
 * "The default host source sees no skills" is exactly the shape of assertion that passes for the
 * wrong reason — an empty result is also what a broken discovery path returns. The planted-home
 * case is its control: the same code, given a home that DOES contain a skill, must find it. Only
 * the pair distinguishes "isolated" from "not looking".
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SkillCommandSource } from '../commands/skill-source.js';
import { createDefaultUserContributionSources } from '../contributions/initial-contribution-sources.js';

/** The variable `vitest.shared.ts` publishes so a test can name the directory it should be given. */
const ISOLATED_HOME_ENV = 'ROBOTA_VITEST_ISOLATED_HOME';

describe('vitest home isolation (TEST-013)', () => {
  it('publishes the isolated home directory it created', () => {
    const declared = process.env[ISOLATED_HOME_ENV];
    expect(declared, `${ISOLATED_HOME_ENV} must be set by vitest.shared.ts`).toBeTruthy();
  });

  it('gives this test process the isolated home through HOME, USERPROFILE and homedir()', () => {
    const declared = process.env[ISOLATED_HOME_ENV]!;

    expect(process.env.HOME).toBe(declared);
    expect(process.env.USERPROFILE).toBe(declared);
    // The assertion that survives a pool change: what the code under test actually resolves.
    expect(homedir()).toBe(declared);
  });

  it('points at a directory that EXISTS', () => {
    // A missing root and an empty root are different failures: `createNodeHostContributionSource`
    // swallows `ENOENT` and returns no reader at all, so a home that was never created makes every
    // host-owned read a no-op rather than an empty read — and the two are indistinguishable from
    // inside a test. Without this line, deleting the `mkdtempSync` in `vitest.shared.ts` and
    // pointing `HOME` at a bare path would leave every assertion in this file green.
    expect(statSync(process.env[ISOLATED_HOME_ENV]!).isDirectory()).toBe(true);
  });

  it('is not the machine’s real home', () => {
    // `userInfo()` reads the password database, so it reports the REAL home no matter what `HOME`
    // says. Without this, the two assertions above would also pass if `HOME` were left untouched.
    expect(homedir()).not.toBe(userInfo().homedir);
  });

  describe('the isolation is enforced, not merely declared', () => {
    let plantedHome: string;

    beforeAll(() => {
      plantedHome = mkdtempSync(join(tmpdir(), 'vitest-home-isolation-planted-'));
      const skillDir = join(plantedHome, '.claude', 'skills', 'host-supplied-decoy');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        ['---', 'name: host-supplied-decoy', 'description: Planted', '---', 'Planted'].join('\n'),
        'utf8',
      );
    });

    afterAll(() => {
      rmSync(plantedHome, { recursive: true, force: true });
    });

    it('the production default, called with NO argument, discovers no user skill', () => {
      const names = new SkillCommandSource(createDefaultUserContributionSources())
        .getCommands()
        .map((command) => command.name);

      expect(names).toEqual([]);
    });

    it('and that emptiness is not the discovery path being broken', () => {
      const names = new SkillCommandSource(createDefaultUserContributionSources(plantedHome))
        .getCommands()
        .map((command) => command.name);

      expect(names).toContain('host-supplied-decoy');
    });
  });
});
