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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, beforeAll } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import { skippedSuiteSpans } from '../check-functional-coverage.mjs';

import {
  collectFireSitesFromSource,
  collectPolicyRows,
  evaluate,
  findFireSites,
  readEventUnion,
  readsBlockedInScope,
  blankComments,
  isProductionSource,
  examinedRowCount,
  examinedFireSiteCount,
  examinedDerivedCount,
  examinedReadCount,
  unclassifiedEntries,
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

/**
 * A fire-site corpus this suite OWNS (issue #2280).
 *
 * The exact count `measurement-provenance` requires used to be `toBe(13)` against the live
 * workspace, so any package adding a `runHooks(` call turned this SEC-016 suite red in a file its
 * author never touched. The count was right and the coupling was still wrong.
 *
 * The paths are production-SHAPED but do not exist on disk — `isProductionSource` positively
 * requires `packages|apps/<name>/src/`, so a fixture tree under `scripts/` is never counted, and one
 * under `packages/` is what this scan already declined to write because a parallel suite would see
 * it. Injection gives the exactness without either.
 *
 * FIVE sites: two in the first file, one in the second, and the third file is gated OUT — which is
 * what makes the number a measurement of the walk rather than of the array's length.
 */
const FIXTURE_CORPUS = [
  { relative: 'packages/fixture-pkg/src/a.ts', source: 'runHooks(one);\nrunHooks(two);\n' },
  { relative: 'packages/fixture-pkg/src/b.ts', source: 'runHooks(three);\n' },
  { relative: 'packages/fixture-pkg/src/c.ts', source: 'runHooks(four);\nrunHooks(five);\n' },
  { relative: 'scripts/harness/not-production.ts', source: 'runHooks(gated);\n' },
];
const FIXTURE_SITE_COUNT = 5;

describe('scan-hook-enforcement-reachable', () => {
  it('passes on the shipped policy, and says what it examined', () => {
    const { code, output } = runScan(realPolicy);
    expect(code).toBe(0);
    // `::examined::` is the harness's provenance convention: "checked and clean" must be
    // distinguishable from "found nothing to check" in the scan's own output.
    expect(output).toMatch(
      /::examined:: \d+ policy row\(s\), \d+ non-test runHooks fire site\(s\) across \d+ read of \d+ derived production file\(s\)/,
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
      // Two properties, deliberately split (issue #2280).
      //
      // Against the LIVE workspace the counter must follow the walk it was given — that is what a
      // derived comparison pins, and it is not coupled to any package's edits.
      const sites = findFireSites(['packages', 'apps']);
      expect(examinedFireSiteCount()).toBe(sites.length);

      // Against a corpus this suite OWNS the count is EXACT, which is what catches a walk that
      // under-reads: a derived comparison re-runs the same walk and cannot see it read too little.
      findFireSites(null, FIXTURE_CORPUS);
      expect(examinedFireSiteCount()).toBe(FIXTURE_SITE_COUNT);
      expect(examinedFireSiteCount()).toBe(5);
    });

    it('reads every TypeScript flavour the derivation admits, and reports derived vs read (issue #2242)', () => {
      // `isProductionSource` admitted a `.tsx`/`.mts`/`.cts` fire site and a `.ts`-only filter then
      // discarded it — a denylist wearing the derivation's clothes. For an `enforcing` row that miss
      // is loud; for the `[stale-reachability]` arm it was silent.
      const corpus = [
        { relative: 'packages/p/src/a.ts', source: 'runHooks(one);\n' },
        { relative: 'packages/p/src/b.tsx', source: 'runHooks(two);\n' },
        { relative: 'packages/p/src/c.mts', source: 'runHooks(three);\n' },
        { relative: 'packages/p/src/d.cts', source: 'runHooks(four);\n' },
        // Derived (it is under src/) but not code: counted as derived, never read.
        { relative: 'packages/p/src/styles.css', source: null },
        { relative: 'packages/p/src/README.md', source: '# runHooks(\n' },
        // Gated OUT by the derivation, so it appears in neither count.
        { relative: 'scripts/harness/not-production.tsx', source: 'runHooks(gated);\n' },
      ];
      const sites = findFireSites(null, corpus);
      expect(sites.map((site) => site.file)).toEqual([
        'packages/p/src/a.ts',
        'packages/p/src/b.tsx',
        'packages/p/src/c.mts',
        'packages/p/src/d.cts',
      ]);
      expect(examinedFireSiteCount()).toBe(4);
      expect(examinedDerivedCount()).toBe(6);
      expect(examinedReadCount()).toBe(4);
      expect(unclassifiedEntries()).toEqual([]);
    });

    it('an entry the derivation admits but the reader cannot classify is reported, not passed over', () => {
      const corpus = [
        { relative: 'packages/p/src/a.ts', source: 'runHooks(one);\n' },
        { relative: 'packages/p/src/blob.unknown-ext', source: null },
      ];
      findFireSites(null, corpus);
      expect(examinedDerivedCount()).toBe(2);
      expect(examinedReadCount()).toBe(1);
      expect(unclassifiedEntries()).toEqual(['packages/p/src/blob.unknown-ext']);
      // And the list is reset by the next walk rather than accumulating.
      findFireSites(null, FIXTURE_CORPUS);
      expect(unclassifiedEntries()).toEqual([]);
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
      findFireSites(null, FIXTURE_CORPUS);
      const first = examinedFireSiteCount();
      findFireSites(null, FIXTURE_CORPUS);
      expect(examinedFireSiteCount()).toBe(first);
      expect(examinedFireSiteCount()).toBe(5);
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

    it('fails when only the POSTURE is flipped to advisory and the site still enforces (issue #2259)', () => {
      // The one-field disarm: `posture: 'advisory'`, `enforcementReachable: true` left as it was,
      // the enforcing code untouched. Before the mirror arm this was caught by `[no-enforcing-rows]`
      // alone — an accident of PreToolUse being the ONLY enforcing row.
      const mutant = realPolicy.replace(
        "      posture: 'enforcing',\n      enforcementReachable: true,",
        "      posture: 'advisory',\n      enforcementReachable: true,",
      );
      expect(mutant, 'mutation did not apply').not.toBe(realPolicy);

      const { code, output } = runScan(mutant);
      expect(code).not.toBe(0);
      expect(output).toContain('[enforcing-advisory-row]');
      expect(output).toContain('PreToolUse');
    });

    it('the mirror arm fires with a SECOND enforcing row present, so [no-enforcing-rows] is not what catches it', () => {
      // Two enforcing rows; PreToolUse flipped to advisory while its site awaits and reads
      // `.blocked`. The table now has an enforcing row, so arm 2 stays quiet — and before #2259
      // nothing else said anything.
      const honouring = (event) => ({
        file: 'x.ts',
        line: 1,
        events: [event],
        awaited: true,
        readsBlocked: true,
      });
      const findings = evaluate(
        new Map([
          ['PreToolUse', { posture: 'advisory', reachable: true }],
          ['PostToolUse', { posture: 'enforcing', reachable: true }],
        ]),
        [honouring('PreToolUse'), honouring('PostToolUse')],
        ['PreToolUse', 'PostToolUse'],
      );
      const text = findings.join('\n');
      expect(text).not.toContain('[no-enforcing-rows]');
      expect(text).toContain('[enforcing-advisory-row] PreToolUse');
      expect(text).not.toContain('[enforcing-advisory-row] PostToolUse');
    });

    it('does not fire for an advisory row whose site fires and forgets (the honest advisory case)', () => {
      const findings = evaluate(
        new Map([
          ['PreToolUse', { posture: 'enforcing', reachable: true }],
          ['PostToolUse', { posture: 'advisory', reachable: false }],
        ]),
        [
          { file: 'x.ts', line: 1, events: ['PreToolUse'], awaited: true, readsBlocked: true },
          { file: 'x.ts', line: 2, events: ['PostToolUse'], awaited: false, readsBlocked: false },
        ],
        ['PreToolUse', 'PostToolUse'],
      );
      expect(findings.join('\n')).not.toContain('[enforcing-advisory-row]');
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

  describe('a regex literal is not a comment', () => {
    // The third re-entry of this scan's founding defect: something that is not code vouching for a
    // gate that no longer exists. First a comment, then a stray `}` inside a comment, now the `//`
    // that ends a regex. Reading it as a line comment blanked the REST OF THAT LINE, including a
    // closing `]`, and a blanked unmatched bracket makes the brace walks over-run: the permissive
    // direction the docblock had claimed was impossible.
    //
    // No count is given here on purpose. Three different numbers have been attached to this
    // paragraph across three rounds — "four times in the scanned file", then "three times in the
    // scan's own source", then "135 of 1650 files" — and every one was measured wrong, each by a
    // different method. A fourth attempt was made here and was also wrong. The limitation is what
    // these cases pin; every count attached to it has been false, so none is given — honouring the
    // sentence above instead of contradicting it three lines later.
    // Of the FIVE cases below only THIS one goes red when the regex branch is disabled. The other
    // four guard different properties — that real comments still blank, that division is not
    // mistaken for a regex, that a `/` inside a character class does not terminate one, and that a
    // quote before a slash (the shape that actually misfires) leaves the following line intact — and
    // a disabled branch does not affect them. Recorded so "it went red under the mutant" is not read
    // as covering all five. This count was stale by one after round 18 added the quote case, which
    // is the same defect the paragraph above is about, committed inside the apology for it.
    it('keeps a regex containing escaped slashes, and the code after it', () => {
      const src = ['const NON_PRODUCTION = [/\\/dist\\//];', 'const keep = 1;'].join('\n');

      const out = blankComments(src);

      expect(out.split('\n')[0]).toBe(src.split('\n')[0]);
      expect(out).toContain('const keep = 1;');
    });

    it('still blanks a real line comment that follows a regex', () => {
      const src = ['const re = /a\\/b/; // this must go', 'const keep = 2;'].join('\n');

      const out = blankComments(src);

      expect(out).toContain('const re = /a\\/b/;');
      expect(out).not.toContain('this must go');
    });

    it('a quote before a slash is the case that actually misfires', () => {
      // The division case below uses an IDENTIFIER before `/`, which the value-position rule already
      // handles — so it pins the easy half. The heuristic's real misfire is a quote or backtick
      // before the slash, which is not in the value-position class. Recorded with what it does today
      // rather than asserted as safe: the branch SKIPS rather than blanks, so a misfire leaves a
      // following comment as code (contained under #2258, see `blankComments`).
      const src = ["const q = s.endsWith('x') / 2; // tail", 'const keep = 9;'].join('\n');

      const out = blankComments(src);

      // Whatever the heuristic decides here, the line after it must survive intact — that is the
      // property a reader can rely on, and the one a widened skip would break.
      expect(out.split('\n')[1]).toBe('const keep = 9;');
      expect(out).toHaveLength(src.length);
    });

    it('does not mistake division for a regex', () => {
      const src = ['const ratio = total / count; // gone', 'const keep = 3;'].join('\n');

      const out = blankComments(src);

      expect(out).toContain('const ratio = total / count;');
      expect(out).not.toContain('gone');
    });

    it('honours a slash inside a character class', () => {
      const src = ['const re = /[/]/;', 'const keep = 4;'].join('\n');

      expect(blankComments(src).split('\n')[0]).toBe(src.split('\n')[0]);
    });
  });

  describe('the union reader blanks comments too — the fourth call site', () => {
    // `blankComments` has FOUR call sites. Three were fixtured; this one was not, and removing the
    // blanking here left all 39 cases green. The enumeration that drove the derived-fixture work
    // said "three blanking call sites" while four existed in the same commit, so the site was never
    // reached — an enumeration that miscounts its own subject leaves exactly the element it missed.
    //
    // It is also the most consequential of the four: it decides the EVENT UNION, which is the
    // population every other arm is judged against. A commented-out member counted as real silently
    // changes what "all 16 events" means.
    function unionFixture(body) {
      const root = path.join(scratch, `union-${Math.random().toString(36).slice(2)}`);
      mkdirSync(path.join(root, 'packages/agent-core/src/hooks'), { recursive: true });
      writeFileSync(path.join(root, 'packages/agent-core/src/hooks/types.ts'), body);
      return root;
    }

    it('does not count a commented-out member of the union', () => {
      const root = unionFixture(
        [
          'export type THookEvent =',
          "  | 'PreToolUse'",
          "  // | 'RetiredEvent'",
          "  | 'PostToolUse';",
          '',
        ].join('\n'),
      );

      expect(readEventUnion(root)).toEqual(['PreToolUse', 'PostToolUse']);
    });

    it('does not count an event name quoted in a comment above the union', () => {
      const root = unionFixture(
        [
          "// Historically this also carried 'GhostEvent', removed in a later revision.",
          'export type THookEvent =',
          "  | 'PreToolUse'",
          "  | 'PostToolUse';",
          '',
        ].join('\n'),
      );

      expect(readEventUnion(root)).toEqual(['PreToolUse', 'PostToolUse']);
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
      // Third revision. Each earlier one could not fail in a way review demonstrated by running it.
      //
      // v1 anchored the code to a leading backtick, so `${event}: [code] …` was invisible.
      // v2 accepted a COMMENT as a fixture, so an arm could be deleted with its assertions and the
      //    two prose mentions left behind still vouched for it.
      // v3 (this) closes three more escapes review found: a code built into a local `const` and
      //    pushed by name, a code containing a digit, and — worst — `toBeGreaterThan(5)`, a FLOOR,
      //    which passed while the derivation silently lost three of the nine codes. This file argues
      //    against floor assertions a few hundred lines above and then used one.
      //
      // The shape that closes the shrink direction is a THREE-WAY equality: the docblock's
      // enumeration, the codes derived from `evaluate`'s body, and the codes positively asserted by
      // tests must all be the same set. Any one of them drifting — a new arm, a lost derivation, a
      // deleted assertion — breaks the equality from a different side.
      // Token shape kept permissive: a hyphen requirement made a code like `[phantomarm]`
      // invisible to ALL THREE derivations at once, which the literal anchor cannot rescue — the
      // anchor pins the nine known codes, it cannot see a tenth the rule never admitted.
      const codeToken = /\[([a-z][a-z0-9-]*)\]/g;

      // (1) the docblock's enumerated list — the human-facing promise
      const docblock = SCAN_SOURCE.slice(0, SCAN_SOURCE.indexOf('*/'));
      const documented = new Set([...docblock.matchAll(codeToken)].map((m) => m[1]));

      // (2) EVERY `findings.push(` site in the file, not a positional slice of one function. The
      // previous revision sliced `evaluate`'s body between `export function evaluate(` and the next
      // `\nexport `, which returns -1 today — so the window silently ran to EOF while the comment
      // said "evaluate's body", and an arm in any other function was invisible regardless.
      const emitted = new Set();
      // Every way the array is appended to, not just `.push(` — the case is named "every finding code
      // the scan CAN EMIT", and an arm using `.unshift(` was a real arm with a real code invisible to
      // all three sets at once.
      const pushSites = [...SCAN_SOURCE.matchAll(/findings\.(?:push|unshift|splice)\(/g)];
      expect(pushSites.length, 'no emission sites found — the derivation broke').toBeGreaterThan(0);
      // Bound each window by COUNTING PARENS from the site's own opener, not by searching for a
      // closer at a guessed indentation. The previous revision looked for a closer preceded by
      // exactly four spaces, while seven of the nine sites close at six — so every one of those
      // windows walked past its own closer into the arms below, and a code-less emission borrowed a
      // neighbour's code. The assertion below could not fire for any arm inside `evaluate`, while
      // this file's comment and the commit message both promised it did. Paren counting is the
      // technique `bodyEnd` and `skippedSuiteSpans` already use here.
      const pushWindow = (from) => {
        let depth = 0;
        for (let i = SCAN_SOURCE.indexOf('(', from); i < SCAN_SOURCE.length; i++) {
          const c = SCAN_SOURCE[i];
          if (c === '(') depth++;
          else if (c === ')' && --depth === 0) return SCAN_SOURCE.slice(from, i + 1);
        }
        // Never fall back to a whole-file window: that IS revision 1's failure mode, and it fails
        // in whichever direction the surrounding text happens to give. An unbalanced site is a
        // derivation that cannot answer, which is a failure rather than a wide guess.
        throw new Error(`unbalanced emission site at index ${from} — the window cannot be bounded`);
      };

      for (const site of pushSites) {
        const window = pushWindow(site.index);
        const codes = [...window.matchAll(codeToken)].map((m) => m[1]);
        // An emission with no recognisable code is itself the failure: it means either a new arm
        // whose code the token does not admit, or a push the derivation cannot classify. Either way
        // the set below is incomplete and must not be compared as if it were whole.
        expect(
          codes.length,
          `emission site with no recognisable code near index ${site.index}`,
        ).toBeGreaterThan(0);
        for (const code of codes) emitted.add(code);
      }

      // (3) codes named by a POSITIVE assertion in comment-blanked test source.
      //
      // LIMIT, stated because this half is a heuristic over assertion shapes and the repository
      // already rejected that approach in general: `check-fixture-floor.mjs` records that detecting
      // the red direction textually "would itself be a check that cannot reliably fail", and the
      // undelivered general mechanism is HARNESS-098's second stage (whose record contradicts
      // itself — issue #2264). This is a local, deliberately narrow approximation: it catches a code
      // named nowhere and a code named only in prose. It does NOT establish that the naming
      // assertion is meaningful, and a `.toContain` inside a skipped suite still counts.
      //
      // A skipped suite must not vouch: `describe.skip` counting as live coverage is the
      // paper-coverage shape `check-functional-coverage.mjs` already owns, so its span finder is
      // reused rather than re-derived. And the argument is un-wrapped first, because Prettier
      // splits a long `.toContain(` across lines and a line-scoped filter would then drop the code —
      // failing safe, but a spurious red is still a guard nobody trusts.
      const liveTestSource = (() => {
        // `skippedSuiteSpans` finds `describe.skip` spans; rewriting `it.skip(` to `describe.skip(`
        // first lets the same paren-counting reach a skipped CASE as well. The alternation matches
        // the helper's own `skip|todo|skipIf`; narrower than its consumer would let an `it.skipIf`
        // case vouch while not running, and `skipIf` is a live idiom in this repo, without re-deriving the
        // walker. Its spans are TUPLES — the first integration read `.start`/`.end`, got `undefined`
        // twice, blanked nothing, and still reported 41/41. Only the mutant probe showed it.
        const blanked = blankComments(TEST_SOURCE).replace(
          /\bit\s*\.\s*(skip|todo|skipIf)\s*\(/g,
          'describe.$1(',
        );
        let out = blanked;
        for (const [start, end] of skippedSuiteSpans(blanked)) {
          out = out.slice(0, start) + ' '.repeat(end - start) + out.slice(end);
        }
        return out.replace(/\.(toContain|toMatch)\(\s+/g, '.$1(');
      })();

      const asserted = new Set(
        liveTestSource
          .split('\n')
          .filter((line) => /\.toContain\(|\.toMatch\(/.test(line) && !/not\s*\.\s*to/.test(line))
          .flatMap((line) => [...line.matchAll(codeToken)].map((m) => m[1])),
      );

      // (0) The anchor. Sets derived by one rule cannot disagree about what that rule MEANS —
      // narrowing the token once made all three shrink together and stay equal. A derivation
      // compared only against other derivations can shrink silently; compared against a literal it
      // cannot, because data does not narrow itself and losing an entry is a visible edit.
      const EXPECTED_CODES = [
        'enforcing-advisory-row',
        'inert-enforcing-row',
        'no-enforcing-rows',
        'policy-row-not-parsed',
        'policy-row-unknown-event',
        'reachability-contradiction',
        'stale-reachability',
        'unreadable-event-union',
        'unresolvable-fire-site',
        'unresolved-policy-row',
      ];

      const sorted = (set) => [...set].sort();
      expect(sorted(emitted), 'codes emitted file-wide vs the expected set').toEqual(
        [...EXPECTED_CODES].sort(),
      );
      // Exact equality in both directions, never a floor: a derivation that shrinks fails against
      // the docblock, and an arm added to either without the other fails too.
      expect(sorted(emitted), 'codes in evaluate() vs the docblock enumeration').toEqual(
        sorted(documented),
      );
      expect(sorted(asserted), 'codes positively asserted vs codes emitted').toEqual(
        sorted(emitted),
      );
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
