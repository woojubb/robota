/**
 * SEC-016 TC-07 — the fixture floor for `scan-hook-enforcement-reachable.mjs`.
 *
 * HARNESS-098's reasoning is the whole point of this file: a check with no fixture has never been
 * shown to go red on the condition it names. Each case below constructs a policy that is broken in
 * exactly one way, runs the real scan against it, and asserts BOTH that it exits non-zero and that
 * the finding names the right condition — because a scan that fails for the wrong reason is a scan
 * that will pass for the wrong reason later.
 *
 * The scan's own failure modes get as much attention as the mutants. A check that reports clean
 * having examined nothing is the defect it exists to prevent, one layer up.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, beforeAll } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  collectPolicyRows,
  findFireSites,
  examinedRowCount,
  examinedFireSiteCount,
} from '../scan-hook-enforcement-reachable.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCAN = path.join(WORKSPACE_ROOT, 'scripts/harness/scan-hook-enforcement-reachable.mjs');
const POLICY = path.join(WORKSPACE_ROOT, 'packages/agent-core/src/hooks/enforcement-policy.ts');

let scratch;
let realPolicy;

beforeAll(() => {
  // `makeTemp` is the harness's owner for temporary directories — it tracks and releases them, so a
  // test cannot leak one. Creating a temp dir directly is what `temp-dir-owner` refuses.
  scratch = makeTemp('robota-sec-016-scan-');
  realPolicy = readFileSync(POLICY, 'utf8');
});

/** Run the scan against a policy fixture; return its exit code and combined output. */
function runScan(policySource) {
  const fixture = path.join(scratch, `policy-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(fixture, policySource);
  try {
    const stdout = execFileSync('node', [SCAN, '--policy', fixture], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('scan-hook-enforcement-reachable', () => {
  it('passes on the shipped policy, and says what it examined', () => {
    const { code, output } = runScan(realPolicy);
    expect(code).toBe(0);
    // `::examined::` is the harness's provenance convention: "checked and clean" must be
    // distinguishable from "found nothing to check" in the scan's own output.
    expect(output).toMatch(
      /::examined:: \d+ policy row\(s\), \d+ non-test runHooks fire site\(s\)/,
    );
    expect(output).toContain('enforcing: PreToolUse');
  });

  // ── measurement-provenance: the reported size must come from the walk, and be pinned ──────────
  describe('the sizes it reports about itself', () => {
    it('examinedRowCount is exactly the union size, and comes from the parse', () => {
      // Exact, not `toBeGreaterThan`. A floor assertion passes on a traversal that read one row and
      // on one that read all sixteen, which is the under-reporting `measurement-provenance.md` names.
      collectPolicyRows(POLICY);
      expect(examinedRowCount()).toBe(16);
    });

    it('examinedFireSiteCount is exactly what the walk read', () => {
      const sites = findFireSites(['packages', 'apps']);
      expect(examinedFireSiteCount()).toBe(sites.length);
      expect(examinedFireSiteCount()).toBe(17);
    });

    it('examinedRowCount resets on a SECOND run rather than accumulating', () => {
      // A counter that sums across runs reports a number that grows every time the scan is invoked,
      // which reads as a widening traversal and is the opposite. Two identical runs must agree.
      collectPolicyRows(POLICY);
      const first = examinedRowCount();
      collectPolicyRows(POLICY);
      expect(examinedRowCount()).toBe(first);
      expect(examinedRowCount()).toBe(16);
    });

    it('examinedFireSiteCount resets on a SECOND run rather than accumulating', () => {
      findFireSites(['packages', 'apps']);
      const first = examinedFireSiteCount();
      findFireSites(['packages', 'apps']);
      expect(examinedFireSiteCount()).toBe(first);
      expect(examinedFireSiteCount()).toBe(17);
    });

    it('the counters move with the input rather than being constants', () => {
      // The check that separates a real counter from a hardcoded number: a narrower pathspec must
      // produce a smaller count, and the reader must follow it.
      const all = findFireSites(['packages', 'apps']);
      const narrowed = findFireSites(['packages/agent-session']);
      expect(narrowed.length).toBeLessThan(all.length);
      expect(examinedFireSiteCount()).toBe(narrowed.length);
    });
  });

  it('the shipped policy really does declare exactly one enforcing event', () => {
    // Guards the fixture rather than the scan: if a future change makes a second event enforcing,
    // every case below still passes while testing something other than what it claims.
    //
    // Anchored to a table ROW — start of line, trailing comma — not to the phrase. The first version
    // of this matched `/posture:\s*'enforcing'/` and counted 2, because the module's own doc comment
    // contains the phrase in a code span. A guard that counts prose is a guard that will one day be
    // satisfied by prose.
    const enforcingRows = [...realPolicy.matchAll(/^\s+posture: 'enforcing',$/gm)];
    expect(enforcingRows).toHaveLength(1);
  });

  describe('the wide mutant — a row asserting a gate its fire site cannot operate', () => {
    it('fails when an advisory event is flipped to enforcing with reachability flipped too', () => {
      // Internally consistent, so `assertPolicyCoherent` cannot see it. Nothing behavioural sees it
      // either: every enforcement test drives PreToolUse, and the advisory-events test is a negative
      // assertion this mutant satisfies. This scan is the only thing standing there.
      const mutant = realPolicy.replace(
        "    PostToolUse: firesAndForgets('tool-hook-helpers.ts'),",
        "    PostToolUse: { posture: 'enforcing', enforcementReachable: true, rationale: 'mutant' },",
      );
      expect(mutant, 'mutation did not apply — the case would pass vacuously').not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[inert-enforcing-row]');
      expect(output).toContain('PostToolUse');
    });
  });

  describe('the narrow mutant — a self-contradictory row', () => {
    it('fails when a row claims enforcing with enforcementReachable: false', () => {
      const mutant = realPolicy.replace(
        "    SessionEnd: awaitsButIgnoresBlocked('session-lifecycle.ts', 'nothing'),",
        "    SessionEnd: { posture: 'enforcing', enforcementReachable: false, rationale: 'mutant' },",
      );
      expect(mutant).not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[reachability-contradiction]');
      // `assertPolicyCoherent` catches this one too, deliberately — two independent checks, so
      // whichever is skipped is not the only thing standing between the two fields.
    });
  });

  describe('the scan must not report clean having checked nothing', () => {
    it('fails on a policy with zero enforcing rows', () => {
      const mutant = realPolicy.replace(
        "      posture: 'enforcing',\n      enforcementReachable: true,",
        "      posture: 'advisory',\n      enforcementReachable: false,",
      );
      expect(mutant).not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[no-enforcing-rows]');
    });

    it('fails on a policy file it cannot parse into rows', () => {
      const { code, output } = runScan('// no policy here at all\nexport const NOTHING = 1;\n');
      expect(code).not.toBe(0);
      expect(output).toMatch(/parsed zero policy rows/);
    });

    it('fails when the policy module does not exist', () => {
      let code = 0;
      let output = '';
      try {
        execFileSync('node', [SCAN, '--policy', 'packages/does/not/exist.ts'], {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        code = err.status ?? 1;
        output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(code).not.toBe(0);
      expect(output).toMatch(/policy module not found/);
    });

    it('fails when the source enumeration finds no fire sites', () => {
      // The `commitlint` precedent's second arm (INFRA-058): a range that resolves but is empty is
      // degenerate, not clean. An enumeration that matched nothing is the same shape.
      let code = 0;
      let output = '';
      try {
        execFileSync('node', [SCAN, '--src', 'scripts/harness/__tests__'], {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        code = err.status ?? 1;
        output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(code).not.toBe(0);
      expect(output).toMatch(/zero non-test runHooks fire sites/);
    });
  });

  describe('a stale reachability flag', () => {
    it('fails when a row records unreachable but its fire site awaits and reads blocked', () => {
      const mutant = realPolicy.replace(
        "      posture: 'enforcing',\n      enforcementReachable: true,",
        "      posture: 'enforcing',\n      enforcementReachable: false,",
      );
      expect(mutant).not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[reachability-contradiction]');
    });
  });
});
