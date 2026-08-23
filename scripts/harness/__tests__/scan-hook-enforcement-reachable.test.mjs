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
  collectFireSitesFromSource,
  collectPolicyRows,
  evaluate,
  findFireSites,
  readsBlockedInScope,
  blankComments,
  isProductionSource,
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
      expect(examinedFireSiteCount()).toBe(13);
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
      expect(examinedFireSiteCount()).toBe(13);
    });

    it('the counters move with the input rather than being constants', () => {
      // The check that separates a real counter from a hardcoded number: a narrower pathspec must
      // produce a smaller count, and the reader must follow it.
      const all = findFireSites(['packages', 'apps']);
      const narrowed = findFireSites(['packages/agent-session']);
      expect(narrowed.length).toBeLessThan(all.length);
      expect(examinedFireSiteCount()).toBe(narrowed.length);
    });

    it('the ROW counter moves with its input too, not just the fire-site counter', () => {
      // The case above exercises only `examinedFireSiteCount`. The row counter had exact-value and
      // reset assertions but nothing that varied its input, so `examinedRows = 16` — a literal —
      // satisfied every one of them. Two rows in, two rows counted.
      const twoRows = path.join(scratch, `two-rows-${Math.random().toString(36).slice(2)}.ts`);
      writeFileSync(
        twoRows,
        [
          'export const HOOK_ENFORCEMENT_POLICY: Readonly<Record<THookEvent, IHookEventPolicy>> = Object.freeze({',
          "    PreToolUse: { posture: 'enforcing', enforcementReachable: true, rationale: 'a' },",
          "    PostToolUse: { posture: 'advisory', enforcementReachable: false, rationale: 'b' },",
          '});',
          '',
        ].join('\n'),
      );

      const { entries } = collectPolicyRows(twoRows);
      expect(entries.size).toBe(2);
      expect(examinedRowCount()).toBe(2);
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
      // Drives `[stale-reachability]` specifically: PreToolUse turned ADVISORY, so it is not an
      // enforcing row, yet its fire site plainly awaits and reads `.blocked`. The first version of
      // this case flipped the posture to `enforcing` and asserted
      // `[reachability-contradiction]` — a different arm — so `[stale-reachability]` had no fixture
      // at all while a describe block claimed to cover it. Review found it.
      const mutant = realPolicy.replace(
        "      posture: 'enforcing',\n      enforcementReachable: true,",
        "      posture: 'advisory',\n      enforcementReachable: false,",
      );
      expect(mutant, 'mutation did not apply').not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[stale-reachability]');
      expect(output).toContain('PreToolUse');
    });

    it('fails when a row claims enforcing AND records unreachable', () => {
      const mutant = realPolicy.replace(
        "      posture: 'enforcing',\n      enforcementReachable: true,",
        "      posture: 'enforcing',\n      enforcementReachable: false,",
      );
      expect(mutant, 'mutation did not apply').not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[reachability-contradiction]');
    });
  });

  describe('a row naming an event with no fire site', () => {
    it('fails with [unresolvable-fire-site] rather than skipping it', () => {
      const mutant = realPolicy.replace(
        "    PostToolUse: firesAndForgets('tool-hook-helpers.ts'),",
        "    PostToolUse: { posture: 'enforcing', enforcementReachable: true, rationale: 'x' },\n    NotAnEvent: { posture: 'enforcing', enforcementReachable: true, rationale: 'x' },",
      );
      expect(mutant, 'mutation did not apply').not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[unresolvable-fire-site]');
      expect(output).toContain('NotAnEvent');
      // And the union comparison notices the stranger independently.
      expect(output).toContain('[policy-row-unknown-event]');
    });
  });

  describe('a policy row the parser cannot read must FAIL, not vanish', () => {
    // The module promises "a row this scan cannot read is a row it did not check — failing rather
    // than skipping". Review showed that promise was false: three valid TypeScript spellings slipped
    // past the inline regex, the row vanished, and the scan exited 0 having examined 15 of 16.
    it.each([
      ['fields reordered', "{ enforcementReachable: true, posture: 'enforcing', rationale: 'x' }"],
      ['rationale omitted', "{ posture: 'enforcing', enforcementReachable: true }"],
      [
        'double-quoted posture',
        '{ posture: "enforcing", enforcementReachable: true, rationale: \'x\' }',
      ],
    ])('%s', (_label, spelling) => {
      const mutant = realPolicy.replace(
        "    PostToolUse: firesAndForgets('tool-hook-helpers.ts'),",
        `    PostToolUse: ${spelling},`,
      );
      expect(mutant, 'mutation did not apply').not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[policy-row-not-parsed]');
      expect(output).toContain('PostToolUse');
    });

    it('a row whose posture the parser cannot resolve fires [unresolved-policy-row]', () => {
      // This arm had no fixture anywhere — `git grep` found the string only at its own emission
      // site, in the arm the module docblock calls "never skipped". Two independent mutants survived
      // the whole suite because of it: downgrading the unresolved marker to a clean 'advisory', and
      // dropping the helper-body bound on the row parser.
      //
      // Driven the way real code would reach it: a helper that spreads a shared base instead of
      // writing the literal, so neither `posture:` literal appears in its body.
      const helper = [
        'const BASE_ADVISORY: IHookEventPolicy = {',
        "  posture: 'advisory',",
        '  enforcementReachable: false,',
        "  rationale: 'base',",
        '};',
        '',
        'function inheritsAdvisory(where: string): IHookEventPolicy {',
        '  return { ...BASE_ADVISORY, rationale: `fires from ${where}` };',
        '}',
        '',
      ].join('\n');
      const mutant =
        helper +
        realPolicy.replace(
          "    PostToolUse: firesAndForgets('tool-hook-helpers.ts'),",
          "    PostToolUse: inheritsAdvisory('tool-hook-helpers.ts'),",
        );
      expect(mutant, 'mutation did not apply').not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[unresolved-policy-row]');
      expect(output).toContain('PostToolUse');
    });
  });

  describe('a demo script must not vouch for the production gate', () => {
    it('an enforcing row is honoured only by product source, not by an example', () => {
      // The defect review found: `findFireSites` excluded `__tests__` but not `examples/`, and
      // `agent-session/examples/verify-hook-outcome-contract.ts` awaits runHooks on PreToolUse and
      // reads `.blocked` — because it DEMONSTRATES the gate. Deleting the entire production gate
      // left this scan green, a demo vouching for something that no longer existed.
      expect(isProductionSource('packages/agent-session/src/tool-hook-helpers.ts')).toBe(true);
      for (const notProduct of [
        // Matches NO exclusion pattern — it fails only the positive `src/` requirement, so it is
        // the one entry that pins the "a new sibling directory must EARN inclusion" half.
        //
        // Do NOT read the rest of this list as one-entry-per-clause: it is not, and an earlier
        // comment here claimed it was. Two entries below are already excluded by the positive
        // `src/` rule and so pin no clause at all, and others match two clauses each — which is why
        // five of the six exclusion clauses survived deletion. The per-clause coverage is asserted
        // separately, by a case that uses one path each which NO other clause and no other rule
        // would reject.
        'packages/agent-core/tools/generate.ts',
        'packages/agent-session/examples/verify-hook-outcome-contract.ts',
        'packages/agent-core/src/hooks/__tests__/enforcement-policy.test.ts',
        'packages/agent-core/src/hooks/types.test.ts',
        'packages/agent-core/dist/node/index.ts',
        'packages/agent-cli/src/__tests__/e2e/fixtures/thing.ts',
      ]) {
        expect(isProductionSource(notProduct), `${notProduct} must not vouch`).toBe(false);
      }
    });

    it('the counted population is product source only', () => {
      const sites = findFireSites(['packages', 'apps']);
      expect(sites.every((s) => isProductionSource(s.file))).toBe(true);
      expect(sites.some((s) => s.file.includes('/examples/'))).toBe(false);
    });
  });

  describe('readsBlocked is scoped to the enclosing block, not the rest of the file', () => {
    // Reported four times before it was taken. `source.slice(source.indexOf(text))` searched from
    // the FIRST textual occurrence of the call line to end-of-FILE. Two consequences, both
    // PERMISSIVE in a scan whose entire job is to refuse a fire site that ignores an enforcing row:
    // an identically-spelled second call site read the first one's window, and any later function
    // whose variable happened to share the name and read `.blocked` vouched for it.
    const SOURCE = [
      'export async function honours(hooks, input) {',
      "  const result = await runHooks(hooks, 'PreToolUse', input);",
      '  if (result.blocked) return false;',
      '  return true;',
      '}',
      '',
      'export async function ignores(hooks, input) {',
      // byte-identical to the call line above — that identity IS the defect
      "  const result = await runHooks(hooks, 'PreToolUse', input);",
      '  return true;',
      '}',
      '',
      // AFTER `ignores`, deliberately. The scope has an upper bound as well as a lower one, and
      // with `ignores` last in the fixture there was nothing beyond it to leak in — so dropping the
      // `bodyEnd` upper bound passed every case. A fixture pins a bound only if something sits on
      // the far side of it.
      'export function later() {',
      '  const result = { blocked: true };',
      '  return result.blocked;',
      '}',
      '',
    ].join('\n');

    /** Byte offset of the line at `index`. */
    function offsetOf(source, index) {
      return source
        .split('\n')
        .slice(0, index)
        .reduce((n, line) => n + line.length + 1, 0);
    }

    it('answers true for the site whose own block reads .blocked', () => {
      expect(readsBlockedInScope(SOURCE, offsetOf(SOURCE, 1), 'result')).toBe(true);
    });

    it('does not let an earlier identical call line vouch for a later one', () => {
      // Measured on the pre-fix code, this returned TRUE — the whole finding.
      expect(readsBlockedInScope(SOURCE, offsetOf(SOURCE, 7), 'result')).toBe(false);
    });

    it('does not let a LATER function vouch either — the scope is bounded at both ends', () => {
      // Same offset as the case above, and it is the same answer for a different reason: `later()`
      // reads `result.blocked` further down the file, so without the upper bound the window would
      // run past `ignores`'s closing brace and find it. Dropping `bodyEnd` from the slice passed all
      // 28 cases before this existed — the lower bound was pinned and the upper bound was not.
      const withoutUpperBound = SOURCE.slice(offsetOf(SOURCE, 6));
      expect(withoutUpperBound).toContain('result.blocked');
      expect(readsBlockedInScope(SOURCE, offsetOf(SOURCE, 7), 'result')).toBe(false);
    });

    it('is false when nothing was assigned, rather than throwing', () => {
      expect(readsBlockedInScope(SOURCE, offsetOf(SOURCE, 1), undefined)).toBe(false);
    });
  });

  describe('comment text does not count as code', () => {
    // Issue #2258. The scan regex-matches file contents, so before this every comment was a
    // potential vouching site. Measured on the real tree: deleting the entire
    // `if (hookResult.blocked) { … }` statement left the scan at exit 0, because a comment three
    // lines below mentioned `hookResult.blocked` in backticks — prose holding up the guard it
    // describes, and that comment had been added by the commit whose purpose was to narrow an
    // over-claim about the same guard.
    it('blanks comments while preserving every offset', () => {
      const src = ['const a = 1; // x.blocked', '/* y.blocked', '   }', '*/', 'const b = 2;'].join(
        '\n',
      );
      const out = blankComments(src);

      // Offset preservation is the requirement, not a nicety: lineOffsets, enclosingBlockStart and
      // bodyEnd all index into this same buffer, so collapsing would shift every later position.
      expect(out).toHaveLength(src.length);
      expect(out.split('\n')).toHaveLength(src.split('\n').length);
      expect(out).not.toMatch(/x\.blocked/);
      expect(out).not.toMatch(/y\.blocked/);
      expect(out).toMatch(/const a = 1;/);
      expect(out).toMatch(/const b = 2;/);
    });

    it('does not treat a comment mentioning .blocked as the site reading it', () => {
      const src = [
        'function ignores(hooks, input) {',
        '  // the `result.blocked` branch used to be here',
        "  const result = await runHooks(hooks, 'PreToolUse', input);",
        '  return true;',
        '}',
      ].join('\n');
      const offset = src
        .split('\n')
        .slice(0, 2)
        .reduce((n, line) => n + line.length + 1, 0);

      expect(readsBlockedInScope(src, offset, 'result')).toBe(false);
    });

    it('does not let a stray brace inside a comment escape the enclosing block', () => {
      // The brace walk counts `{`/`}` literally, so a `}` inside a comment above the call site pops
      // the walker out of the real function and lands the scope on an UNRELATED earlier block. The
      // ordering here is load-bearing: the decoy `.blocked` read has to sit where the widened scope
      // actually lands, which is the block before this one — a fixture with the decoy AFTER the call
      // site passes with or without the fix and therefore pins nothing.
      const src = [
        'function elsewhere() { const result = { blocked: true }; return result.blocked; }',
        'function ignores(hooks, input) {',
        '  // a comment containing a stray } brace',
        "  const result = await runHooks(hooks, 'PreToolUse', input);",
        '  return true;',
        '}',
      ].join('\n');
      const offset = src
        .split('\n')
        .slice(0, 3)
        .reduce((n, line) => n + line.length + 1, 0);

      expect(readsBlockedInScope(src, offset, 'result')).toBe(false);
    });

    it('leaves a // sequence inside a string literal alone', () => {
      // Note this case guards OVER-blanking, so unlike its three siblings it passes with the blanker
      // disabled — a no-op blanker cannot destroy a string. Recorded because "it went red under the
      // mutant" is the evidence for the other three, and this one is not offered as that.
      const src = ['const url = "https://example.test";', 'const r = { blocked: true };'].join(
        '\n',
      );

      expect(blankComments(src)).toContain('https://example.test');
    });
  });

  describe('the blankComments CALL SITES are pinned, not just the helper', () => {
    // `blankComments` itself is well covered; its call sites were not. Dropping the blanking in
    // `collectPolicyRows` left all 31 cases green while producing a fully green scan on a DISARMED
    // policy — the first of the four effects that helper's own docblock enumerates.
    it('a commented-out enforcing row does not override a disarmed real one', () => {
      const disarmed = realPolicy.replace(
        `    PreToolUse: {
      posture: 'enforcing',
      enforcementReachable: true,`,
        `    PreToolUse: {
      posture: 'advisory',
      enforcementReachable: false,`,
      );
      expect(disarmed, 'disarming mutation did not apply').not.toBe(realPolicy);

      const withDecoy = disarmed.replace(
        '  // ── Awaited, but',
        [
          '  /*',
          "    PreToolUse: { posture: 'enforcing', enforcementReachable: true, rationale: 'decoy' },",
          '  */',
          '  // ── Awaited, but',
        ].join('\n'),
      );
      expect(withDecoy, 'decoy insertion did not apply').not.toBe(disarmed);

      const { code, output } = runScan(withDecoy);
      // The real row is advisory, so the table has no enforcing rows and the scan must say so
      // rather than reporting the gate armed on the strength of a comment.
      expect(code).not.toBe(0);
      expect(output).not.toContain('enforcing: PreToolUse');
    });
  });

  describe('a commented-out call is not a fire site', () => {
    // The second blanking call site. `findFireSites` enumerates via `git ls-files`, so this could
    // not be driven from a temp fixture, and the live corpus contains no commented-out `runHooks(`
    // — so nothing exercised it. Testing the per-source unit pins it without writing a fixture file
    // into `packages/`, where a parallel suite would see it.
    it('counts the real call and ignores the commented one', () => {
      const source = [
        'export async function real(hooks, input) {',
        "  const result = await runHooks(hooks, 'PreToolUse', input);",
        '  if (result.blocked) return false;',
        '  return true;',
        '}',
        '',
        "// const dead = await runHooks(hooks, 'PreToolUse', input);",
        '/*',
        "  const alsoDead = await runHooks(hooks, 'PostToolUse', input);",
        '*/',
      ].join('\n');

      const sites = collectFireSitesFromSource('packages/x/src/real.ts', source);

      expect(sites).toHaveLength(1);
      expect(sites[0].readsBlocked).toBe(true);
      expect(sites[0].events).toContain('PreToolUse');
    });

    it('a file whose ONLY call is commented out yields no fire site at all', () => {
      const source = ["// const dead = await runHooks(hooks, 'PreToolUse', input);", ''].join('\n');

      expect(collectFireSitesFromSource('packages/x/src/dead.ts', source)).toEqual([]);
    });
  });

  describe('enclosingBlockStart rebalances nested blocks', () => {
    // Its `depth--` was pinned by nothing, and losing it fails PERMISSIVE — the direction the
    // module docblock claims has been eliminated. The committed fixture had no nested block before
    // either call line, so the decrement was never exercised.
    const NESTED = [
      'function elsewhere() { const result = { blocked: true }; return result.blocked; }',
      'function ignores(hooks, input) {',
      '  if (input) { log(input); }',
      "  const result = await runHooks(hooks, 'PreToolUse', input);",
      '  return true;',
      '}',
    ].join('\n');

    it('a nested block before the call does not push the scope out of the function', () => {
      const offset = NESTED.split('\n')
        .slice(0, 3)
        .reduce((n, line) => n + line.length + 1, 0);

      expect(readsBlockedInScope(NESTED, offset, 'result')).toBe(false);
    });
  });

  describe('arm 0 fails closed when the event union itself cannot be read', () => {
    // The ninth finding code, and the only one with no fixture — deleting its `findings.push` left
    // all 31 cases green. It is the arm that stops the scan judging a policy against nothing, so an
    // unfixtured version of it is a fail-closed branch that could be removed silently.
    it('emits [unreadable-event-union] rather than judging against nothing', () => {
      const findings = evaluate(
        new Map([['PreToolUse', { posture: 'enforcing', reachable: true }]]),
        [],
        null,
      );

      expect(findings.join('\n')).toContain('[unreadable-event-union]');
    });

    it('does not emit it when the union reads normally', () => {
      // The contrast that makes the case above mean something: same call, real union.
      const { entries } = collectPolicyRows(POLICY);
      const findings = evaluate(entries, findFireSites(['packages', 'apps']));

      expect(findings.join('\n')).not.toContain('[unreadable-event-union]');
    });
  });

  describe('every checkable element of this scan has a fixture — derived, not listed', () => {
    // Rounds 10 and 11 each found an unfixtured element, one at a time, because the fixture set was
    // assembled case-by-case from reported defects while the scan's surface is ENUMERABLE. These
    // cases derive the expectation from the source instead, so a NEW arm or clause added later
    // without a fixture fails here rather than waiting for a reviewer to notice.
    const SCAN_SOURCE = readFileSync(SCAN, 'utf8');
    const TEST_SOURCE = readFileSync(
      path.join(
        WORKSPACE_ROOT,
        'scripts/harness/__tests__/scan-hook-enforcement-reachable.test.mjs',
      ),
      'utf8',
    );

    it('every finding code the scan can emit is asserted by a test', () => {
      // Both halves of this were wrong when first written, and review demonstrated each by running
      // it. The derivation anchored the code to a leading backtick, so a tenth arm emitting
      // `${event}: [brand-new-arm] …` was invisible — 39 green with an unfixtured arm. And the
      // predicate was `TEST_SOURCE.includes('[code]')`, which a COMMENT satisfies: an entire
      // security arm was deleted along with its assertions, leaving two comment mentions, and this
      // still passed. "A guard that counts prose is a guard that will one day be satisfied by
      // prose" — the file said that about the scan and then did it here.
      //
      // Now: emission sites found structurally, and the code must sit inside a POSITIVE assertion
      // in comment-blanked test source.
      const emitted = new Set();
      for (const m of SCAN_SOURCE.matchAll(/findings\.push\(/g)) {
        const window = SCAN_SOURCE.slice(m.index, SCAN_SOURCE.indexOf(');', m.index) + 2);
        for (const code of window.matchAll(/\[([a-z][a-z-]+)\]/g)) emitted.add(code[1]);
      }
      expect(emitted.size, 'no finding codes derived — the derivation broke').toBeGreaterThan(5);

      // Comments cannot vouch, and neither can an `it()` title or a `not.toContain`.
      const assertedLines = blankComments(TEST_SOURCE)
        .split('\n')
        .filter((line) => /\.toContain\(|\.toMatch\(/.test(line) && !/not\s*\.\s*to/.test(line));
      const asserted = assertedLines.join('\n');

      const unfixtured = [...emitted].filter((code) => !asserted.includes(`[${code}]`));
      expect(unfixtured, 'finding codes with no POSITIVE assertion naming them').toEqual([]);
    });

    it('every NON_PRODUCTION clause is pinned by a path only that clause excludes', () => {
      // Five of six survived deletion before this: the fixture list masked itself, because entries
      // matched two clauses each or were already excluded by the positive `src/` requirement. A
      // clause is pinned only by a path that NO other clause and NO other rule would reject.
      const listStart = SCAN_SOURCE.indexOf('const NON_PRODUCTION = [');
      expect(listStart, 'NON_PRODUCTION list not found').toBeGreaterThan(-1);
      const clauses = SCAN_SOURCE.slice(listStart, SCAN_SOURCE.indexOf('];', listStart));
      // Count the regex literals, one per line, rather than pattern-matching their bodies.
      const count = clauses.split('\n').filter((line) => line.trim().startsWith('/')).length;

      const oneClauseEach = [
        'packages/agent-core/src/__tests__/helpers.ts', // only /__tests__/
        'packages/agent-core/src/thing.test.ts', //        only \.test\.ts$
        'packages/agent-core/src/examples/demo.ts', //     only /examples?/
        'packages/agent-core/src/fixtures/policy.ts', //   only /fixtures?/
        'packages/agent-core/src/testing/harness.ts', //   only /testing/
        'packages/agent-core/src/dist/bundle.ts', //       only /dist/
      ];
      expect(oneClauseEach).toHaveLength(count);
      for (const p of oneClauseEach) {
        expect(isProductionSource(p), `${p} must not vouch`).toBe(false);
      }
    });
  });
});
