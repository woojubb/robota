import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXECUTION } from '../lib/spawn-call-graph.mjs';

/** The checker as CI invokes it — a process, so the `.catch` path is the code under test. */
const CHECKER = path.resolve(import.meta.dirname, '../check-regression-red-proof.mjs');

import {
  VERDICT,
  enforceOnCrash,
  exitCodeFor,
  addedCaseTitleMatchers,
  classifyChanges,
  classifyVitestOutcome,
  decidePairVerdict,
  decidingFailures,
  defaultReverseApply,
  filesForDefectFixCommits,
  EMPTY_MODULE_SOURCE,
  hasRuntimeSemanticChange,
  isDefectFixRange,
  isSourceFile,
  isTestFile,
  parseOptOut,
  pkgOf,
  qualifyingPairs,
  reachableRelativeGraph,
  relativeSpecifiers,
  resolveRelativeImport,
  reversalBaseFor,
  runRegressionRedProof,
  testExecutesHook,
} from '../check-regression-red-proof.mjs';

// LIMITS testExecutesHook: they hold here — this file TESTS the relation, so what it can and
// cannot resolve is the subject rather than a dependency. Nothing here rides on the answer.

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const abs = (rel) => path.resolve(WORKSPACE_ROOT, rel);

describe('HARNESS-041 file classification', () => {
  it('distinguishes runtime mutations from comments and TypeScript-only contracts', () => {
    expect(
      hasRuntimeSemanticChange(
        'packages/example/src/contracts.ts',
        'export interface Input { executionRoot: string; }',
        'export interface Input {}',
      ),
    ).toBe(false);
    expect(
      hasRuntimeSemanticChange(
        'scripts/harness/check.mjs',
        '// clarified wording\nexport const value = 1;',
        '// old wording\nexport const value = 1;',
      ),
    ).toBe(false);
    expect(
      hasRuntimeSemanticChange(
        'scripts/harness/check.mjs',
        'export function value() { return 2; }',
        'export function value() { return 1; }',
      ),
    ).toBe(true);
  });

  it('treats an ADDED type-only module as no runtime mutation', () => {
    // The base of an added file is an empty MODULE, not an empty file: an empty file has no
    // import or export, so it is emitted as a script with a `"use strict";` prologue the module
    // form lacks -- a difference of framing, not behaviour. Without that, a new file holding
    // nothing but interfaces read as a runtime mutation, was run against the reversed tree, passed
    // (because types are erased), and was reported ACCIDENTAL_GREEN -- a verdict its already-
    // existing siblings correctly reach as "type/comment-only change".
    expect(
      hasRuntimeSemanticChange(
        'packages/example/src/contracts.ts',
        'export interface Added { a: string; }\nexport type Kind = "x" | "y";\n',
        EMPTY_MODULE_SOURCE,
      ),
    ).toBe(false);
  });

  it('still sees an ADDED module that emits runtime code as a mutation', () => {
    expect(
      hasRuntimeSemanticChange(
        'packages/example/src/added.ts',
        'export const value = 1;\n',
        EMPTY_MODULE_SOURCE,
      ),
    ).toBe(true);
  });

  it('pkgOf extracts the package/app root for src files', () => {
    expect(pkgOf('packages/agent-transport-tui/src/CjkTextInput.tsx')).toBe(
      'packages/agent-transport-tui',
    );
    expect(pkgOf('apps/agent-app/src/main.ts')).toBe('apps/agent-app');
    expect(pkgOf('packages/foo/docs/SPEC.md')).toBeNull();
  });

  it('pkgOf also covers the harness and the hooks (INFRA-071)', () => {
    // This assertion used to read `scripts/harness/x.mjs` → null, which pinned the defect as a
    // contract: the gate could not see the layer holding every scan, every floor and every guard.
    // Measured over PRs #1525-#1530 — twelve CI runs, zero verdicts — while human review caught
    // four accidental-green tests in that same window, all under `scripts/harness/__tests__/`.
    expect(pkgOf('scripts/harness/x.mjs')).toBe('scripts/harness');
    expect(pkgOf('scripts/harness/__tests__/x.test.mjs')).toBe('scripts/harness');
    expect(pkgOf('.claude/hooks/branch-guard.sh')).toBe('.claude/hooks');
    expect(pkgOf('.claude/hooks/lib/command-scan.sh')).toBe('.claude/hooks');
    // Documentation is not source. Under the old `packages/*/src` scope this could not arise;
    // scoping a whole directory means a docs-and-test range would otherwise manufacture a pair
    // whose only possible verdict is noise — reversing prose proves nothing.
    expect(pkgOf('scripts/harness/README.md')).toBeNull();
    // Not every file under `.claude/` is a guard; only the shell hooks are red-provable this way.
    expect(pkgOf('.claude/settings.json')).toBeNull();
  });

  it('pairs a changed hook with the harness test that runs it', () => {
    // A hook's tests live in the harness suite, not beside it, so grouping strictly by path put
    // them in different subjects and they could never pair. Adoption is what makes the pair exist.
    const byPkg = classifyChanges([
      '.claude/hooks/branch-guard.sh',
      'scripts/harness/__tests__/branch-base-at-creation.test.mjs',
    ]);
    const hooks = byPkg.get('.claude/hooks');

    expect(hooks.source).toContain('.claude/hooks/branch-guard.sh');
    expect(hooks.test, 'the hook found no test to red-prove it against').toContain(
      'scripts/harness/__tests__/branch-base-at-creation.test.mjs',
    );
  });

  it('adopts nothing when no hook changed', () => {
    // The adoption must not invent a subject: a harness-only change stays a harness change.
    const byPkg = classifyChanges([
      'scripts/harness/x.mjs',
      'scripts/harness/__tests__/x.test.mjs',
    ]);

    expect(byPkg.has('.claude/hooks')).toBe(false);
    expect(byPkg.get('scripts/harness').source).toEqual(['scripts/harness/x.mjs']);
  });

  it('testExecutesHook counts a spawn, not a mention', () => {
    // The relation that stands in for the import graph when the source is a shell script. A hook
    // named in a COMMENT is described, not run — the distinction this gate exists to make, and one
    // an earlier version of this same rule got wrong in the coverage floor beside it.
    const spawns = [
      "import { spawnSync } from 'node:child_process';",
      "const hook = '.claude/hooks/branch-guard.sh';",
      "spawnSync('bash', [hook]);",
    ].join('\n');
    const mentions = [
      "import { spawnSync } from 'node:child_process';",
      '// branch-guard.sh is discussed here',
      "spawnSync('bash', ['.claude/hooks/merge-gate.sh']);",
    ].join('\n');
    const noSpawn = "const p = 'branch-guard.sh';";

    expect(testExecutesHook(spawns, '.claude/hooks/branch-guard.sh')).toBe(EXECUTION.EXECUTES);
    expect(testExecutesHook(mentions, '.claude/hooks/branch-guard.sh')).toBe(
      EXECUTION.NOT_EXECUTED,
    );
    expect(testExecutesHook(noSpawn, '.claude/hooks/branch-guard.sh')).toBe(EXECUTION.NOT_EXECUTED);

    // A documented example — the hook named in real code, the spawn shown in a comment — is not an
    // execution. The text relation needed both halves read from the same comment-stripped source to
    // get this right; reading the call graph gets it right because a comment is not a call.
    const documented = [
      "const hook = 'branch-guard.sh';",
      "// e.g. spawnSync('bash', [hook])",
      'expect(hook).toBeTruthy();',
    ].join('\n');
    expect(testExecutesHook(documented, '.claude/hooks/branch-guard.sh')).toBe(
      EXECUTION.NOT_EXECUTED,
    );
  });

  it('a test that NAMES one hook while spawning another does not execute the first (INFRA-074)', () => {
    // The misclassification the relation was held for. The two halves were independent — the name
    // had to appear, and the file had to spawn a shell — with nothing tying the spawn to the name.
    // This file spawns `worktree-cwd-guard.sh` and only MENTIONS `branch-guard.sh` in a value it
    // asserts on, so it can say nothing about `branch-guard.sh` at all.
    //
    // Recorded against the pre-fix relation, so the case is known to be red rather than assumed:
    //   AssertionError: a bystander that never ran this hook was counted as executing it:
    //   expected true to be false
    const namesOneSpawnsAnother = [
      "import { spawnSync } from 'node:child_process';",
      "import path from 'node:path';",
      "const REGISTERED = ['branch-guard.sh', 'worktree-cwd-guard.sh'];",
      "const result = spawnSync('bash', [path.join(HOOKS_DIR, 'worktree-cwd-guard.sh')]);",
      "expect(REGISTERED).toContain('branch-guard.sh');",
    ].join('\n');

    expect(
      testExecutesHook(namesOneSpawnsAnother, '.claude/hooks/branch-guard.sh'),
      'a bystander that never ran this hook was counted as executing it',
    ).toBe(EXECUTION.NOT_EXECUTED);
    expect(testExecutesHook(namesOneSpawnsAnother, '.claude/hooks/worktree-cwd-guard.sh')).toBe(
      EXECUTION.EXECUTES,
    );
  });

  it('follows the hook name THROUGH a helper that joins it (INFRA-074)', () => {
    // Why a narrower text pattern was rejected on evidence rather than on taste: requiring the name
    // inside a `path.join(...)` missed every test written this way, and these run the hook just as
    // truly. The binding is the argument flowing into `run`, which only the call graph can follow.
    const throughAHelper = [
      "import { spawnSync } from 'node:child_process';",
      "import path from 'node:path';",
      'function run(hook, input) {',
      "  return spawnSync('bash', [path.join(HOOKS_DIR, hook)], { input });",
      '}',
      "run('merge-gate.sh', payload);",
    ].join('\n');

    expect(testExecutesHook(throughAHelper, '.claude/hooks/merge-gate.sh')).toBe(
      EXECUTION.EXECUTES,
    );
    expect(testExecutesHook(throughAHelper, '.claude/hooks/branch-guard.sh')).toBe(
      EXECUTION.NOT_EXECUTED,
    );
  });

  it('a spawn written inside a string literal is not a spawn (INFRA-074)', () => {
    // This very file is the measured instance: it names `branch-guard.sh` and contains the text
    // `spawnSync('bash'` in fixture STRINGS, and the old relation therefore counted it as running
    // the hook. Resolution goes through the import binding and the AST, so quoted code is data.
    const quotedOnly = [
      "const spawns = \"run('branch-guard.sh');\\nspawnSync('bash', [hook]);\";",
      'expect(spawns.length).toBeGreaterThan(0);',
    ].join('\n');

    expect(testExecutesHook(quotedOnly, '.claude/hooks/branch-guard.sh')).toBe(
      EXECUTION.NOT_EXECUTED,
    );
  });

  it('says UNDETERMINED when the spawn target is built at runtime, and never guesses', () => {
    // The third answer, and the reason there is one. A sweep over the hooks directory really does
    // run every hook, so answering "no" would fire this relation's consumers on correct work; but
    // the file names nothing, so answering "yes" would hand a verdict to a case that states nothing
    // about the hook. Both consumers get the ambiguity instead of a coin flip.
    const dynamic = [
      "import { spawnSync } from 'node:child_process';",
      "import { readdirSync } from 'node:fs';",
      "import path from 'node:path';",
      'for (const name of readdirSync(HOOKS_DIR)) {',
      "  spawnSync('bash', [path.join(HOOKS_DIR, name)], { input: '' });",
      '}',
    ].join('\n');

    expect(testExecutesHook(dynamic, '.claude/hooks/branch-guard.sh')).toBe(EXECUTION.UNDETERMINED);

    // And an argument vector that cannot reach a script raises no ambiguity at all: `git` does not
    // run its arguments. Without that distinction every temp-directory argument in the suite made
    // its file undetermined for every hook, which is the grep it replaced wearing a costume.
    const gitOnly = [
      "import { spawnSync } from 'node:child_process';",
      "spawnSync('git', ['-C', someTempDir, 'status']);",
    ].join('\n');

    expect(testExecutesHook(gitOnly, '.claude/hooks/branch-guard.sh')).toBe(EXECUTION.NOT_EXECUTED);
  });

  it('reads the script out of ARGV POSITION, not out of any argument', () => {
    // `bash -n <file>` names the file after a flag; `node run.mjs <tmpdir>` names it first and the
    // rest belong to the script. Treating every element as a possible script made an unresolvable
    // temp directory read as "might run anything" — measured at 331 undetermined pairs over the
    // harness suite against 27 resolved ones.
    const afterAFlag = [
      "import { spawnSync } from 'node:child_process';",
      "import path from 'node:path';",
      "spawnSync('bash', ['-n', path.join(HOOKS_DIR, 'spec-first-gate.sh')]);",
    ].join('\n');
    const asAnArgumentToSomethingElse = [
      "import { spawnSync } from 'node:child_process';",
      "import path from 'node:path';",
      "spawnSync('node', [path.join(HARNESS_DIR, 'scan-hook-registration.mjs'), 'spec-first-gate.sh']);",
    ].join('\n');

    expect(testExecutesHook(afterAFlag, '.claude/hooks/spec-first-gate.sh')).toBe(
      EXECUTION.EXECUTES,
    );
    expect(
      testExecutesHook(asAnArgumentToSomethingElse, '.claude/hooks/spec-first-gate.sh'),
      'a name handed to a scanner AS DATA was read as the file that ran',
    ).toBe(EXECUTION.NOT_EXECUTED);
  });

  it('isTestFile / isSourceFile split correctly', () => {
    expect(isTestFile('packages/x/src/__tests__/a.test.tsx')).toBe(true);
    expect(isTestFile('packages/x/src/a.spec.ts')).toBe(true);
    expect(isTestFile('packages/x/src/a.tsx')).toBe(false);
    expect(isSourceFile('packages/x/src/a.tsx')).toBe(true);
    expect(isSourceFile('packages/x/src/a.test.ts')).toBe(false);
    expect(isSourceFile('README.md')).toBe(false);
  });

  it('qualifyingPairs = packages with BOTH source and test changes', () => {
    const byPkg = classifyChanges([
      'packages/a/src/x.ts',
      'packages/a/src/x.test.ts',
      'packages/b/src/y.ts', // source only
      'packages/c/src/z.test.ts', // test only
    ]);
    const pairs = qualifyingPairs(byPkg);
    expect(pairs.map((p) => p.pkg)).toEqual(['packages/a']);
  });
});

describe('HARNESS-041 scoping (C2) + opt-out', () => {
  it('judges only files owned by defect-fix or floor-adding commits in a mixed range', () => {
    expect(
      filesForDefectFixCommits(
        [
          {
            subject: 'feat(dag): propagate trusted execution root',
            files: ['packages/dag-core/src/interfaces/ports.ts'],
            addedFiles: [],
          },
          {
            subject: 'fix(framework): require accepted turn identity',
            files: [
              'packages/agent-framework/src/interactive/accept.ts',
              'scripts/harness/reverted-before-head.mjs',
            ],
            addedFiles: [],
          },
          {
            subject: 'feat(harness): add a mechanical floor',
            files: [
              'scripts/harness/check-new-floor.mjs',
              'scripts/harness/__tests__/new-floor.test.mjs',
            ],
            addedFiles: ['scripts/harness/__tests__/new-floor.test.mjs'],
          },
        ],
        [
          'packages/agent-framework/src/interactive/accept.ts',
          'scripts/harness/check-new-floor.mjs',
          'scripts/harness/__tests__/new-floor.test.mjs',
        ],
      ),
    ).toEqual([
      'packages/agent-framework/src/interactive/accept.ts',
      'scripts/harness/check-new-floor.mjs',
      'scripts/harness/__tests__/new-floor.test.mjs',
    ]);
  });

  it('a range that ADDS A FLOOR is a defect fix, whatever its subject says', () => {
    // Measured 2026-08-01: five mechanical floors were written in one session and not one of them
    // was judged by this gate, because a floor lands as `feat:` — it adds a capability — while being
    // a fix for a defect CLASS. Three of the five turned out to pass over the very incident they
    // were built for, and all three were found by a person running them by hand.
    //
    // A floor is exactly the artifact whose red proof matters most: it is the thing that will be
    // trusted to catch the next occurrence. So a range that adds one is judged, and its subject line
    // does not get to opt it out.
    expect(isDefectFixRange(['feat: a new mechanical floor'], ['scripts/harness/scan-x.mjs'])).toBe(
      false,
    );
    expect(
      isDefectFixRange(
        ['feat: a new mechanical floor'],
        ['scripts/harness/__tests__/guards-something.test.mjs'],
      ),
      'a new floor escaped the gate because it was not spelled `fix:`',
    ).toBe(true);
    // Not every touched test is a new floor — an EDIT to one is ordinary work, and an edited file is
    // not in the ADDED list. Passing it here as added would have asserted the opposite of the point.
    expect(isDefectFixRange(['docs: wording'], [])).toBe(false);
  });

  it('isDefectFixRange requires a fix: commit and excludes perf:', () => {
    expect(isDefectFixRange(['fix: drop bug', 'chore: x'])).toBe(true);
    expect(isDefectFixRange(['fix(tui): drop bug'])).toBe(true);
    expect(isDefectFixRange(['feat: new', 'docs: y'])).toBe(false);
    expect(isDefectFixRange(['perf: faster'])).toBe(false); // C2
  });

  it('parseOptOut reads allow-green-at-base: <reason>', () => {
    expect(parseOptOut('body\nallow-green-at-base: unrelated fixture test\n')).toEqual({
      optedOut: true,
      reason: 'unrelated fixture test',
    });
    expect(parseOptOut('no marker here')).toEqual({ optedOut: false, reason: null });
  });
});

describe('HARNESS-041 vitest outcome classification (C1 — assertion-fail vs run-error)', () => {
  const testFile = 'packages/x/src/a.test.ts';
  const nameAbs = abs(testFile);

  it('a failed assertion → assertion-fail', () => {
    const json = { testResults: [{ name: nameAbs, assertionResults: [{ status: 'failed' }] }] };
    expect(classifyVitestOutcome(json, [testFile])).toBe('assertion-fail');
  });

  it('all assertions passed → all-pass', () => {
    const json = { testResults: [{ name: nameAbs, assertionResults: [{ status: 'passed' }] }] };
    expect(classifyVitestOutcome(json, [testFile])).toBe('all-pass');
  });

  it('present but zero assertions (failed to collect) → run-error', () => {
    const json = { testResults: [{ name: nameAbs, assertionResults: [] }] };
    expect(classifyVitestOutcome(json, [testFile])).toBe('run-error');
  });

  it('missing from results entirely (transform error) → run-error, NOT all-pass', () => {
    expect(classifyVitestOutcome({ testResults: [] }, [testFile])).toBe('run-error');
  });

  it('multi-file: a run-error file is NOT masked by a passing sibling → run-error (C1 regression)', () => {
    const passing = 'packages/x/src/a.test.ts';
    const brokeCollect = 'packages/x/src/b.test.ts';
    const json = {
      testResults: [
        { name: abs(passing), assertionResults: [{ status: 'passed' }] },
        { name: abs(brokeCollect), assertionResults: [] }, // failed to collect
      ],
    };
    // Before the fix this returned 'all-pass' (→ false accidental-green). It must be run-error.
    expect(classifyVitestOutcome(json, [passing, brokeCollect])).toBe('run-error');
  });

  it('multi-file: an assertion failure still wins over a sibling run-error → assertion-fail', () => {
    const failing = 'packages/x/src/a.test.ts';
    const brokeCollect = 'packages/x/src/b.test.ts';
    const json = {
      testResults: [
        { name: abs(failing), assertionResults: [{ status: 'failed' }] },
        { name: abs(brokeCollect), assertionResults: [] },
      ],
    };
    expect(classifyVitestOutcome(json, [failing, brokeCollect])).toBe('assertion-fail');
  });
});

describe('INFRA-072 per-case granularity — the range judges its OWN new cases', () => {
  const testFile = 'packages/x/src/a.test.ts';
  const nameAbs = abs(testFile);

  it('addedCaseTitleMatchers reads titles off the ADDED lines only', () => {
    const diff = [
      '--- a/packages/x/src/a.test.ts',
      '+++ b/packages/x/src/a.test.ts',
      '@@ -1,3 +1,6 @@',
      " it('an existing case nobody touched', () => {",
      "+  it('the new regression case', () => {",
      '+    expect(fixed()).toBe(1);',
      "-  it('a case this range deleted', () => {",
      '+  it.each(rows)(`${name} keeps its shape`, () => {',
    ].join('\n');

    const matchers = addedCaseTitleMatchers(diff);
    const titles = ['the new regression case', 'branch-guard keeps its shape'];
    expect(titles.every((t) => matchers.some((re) => re.test(t)))).toBe(true);
    // A context line and a REMOVED line are not this range's cases; treating them as such would
    // hand the verdict back to exactly the pre-existing case the granularity exists to exclude.
    expect(matchers.some((re) => re.test('an existing case nobody touched'))).toBe(false);
    expect(matchers.some((re) => re.test('a case this range deleted'))).toBe(false);
  });

  it('an it.each title with printf tokens matches its runtime rows, and NOT a case the range did not add (issue #2216)', () => {
    const diff = [
      "+  it.each(TABLE)('removes %s from the stream', (name) => {",
      "+  test.each(rows)('row %# of %d: %i %f %j %o %$ 100%%', () => {",
      "+  it.each(objects)('handles $kind.name with $count', () => {",
      '+  it.each(rows)(`${prefix} removes %s`, () => {',
    ].join('\n');
    const [removes, printf, keyed, mixed] = addedCaseTitleMatchers(diff);

    expect(removes.test('removes DCS from the stream')).toBe(true);
    expect(removes.test('removes OSC 8 hyperlink from the stream')).toBe(true);
    // The fixture a `/^.*$/` matcher would satisfy: a case the range did NOT add must still miss,
    // or the "fix" has silently restored file granularity while reading as per-case.
    expect(removes.test('keeps DCS in the stream')).toBe(false);
    expect(removes.test('removes DCS')).toBe(false);

    expect(printf.test('row 1 of 3: 2 1.5 {"a":1} {} 1 100%')).toBe(true);
    expect(printf.test('row 1 of 3: 2 1.5 {"a":1} {} 1 100')).toBe(false);

    expect(keyed.test('handles DCS with 3')).toBe(true);
    expect(keyed.test('an existing case nobody touched')).toBe(false);

    expect(mixed.test('sanitizer removes DCS')).toBe(true);
    expect(mixed.test('sanitizer keeps DCS')).toBe(false);

    for (const re of [removes, printf, keyed, mixed]) expect(re.source).not.toBe('^.*$');
  });

  it('a range whose only new cases are it.each rows is assertion-fail, and decidingFailures names the row', () => {
    const added = new Map([
      [nameAbs, addedCaseTitleMatchers("+  it.each(TABLE)('removes %s', () => {")],
    ]);
    const json = {
      testResults: [
        {
          name: nameAbs,
          assertionResults: [
            { title: 'removes DCS', fullName: 'sanitizer removes DCS', status: 'failed' },
            { title: 'an old case', fullName: 'sanitizer an old case', status: 'passed' },
          ],
        },
      ],
    };
    expect(classifyVitestOutcome(json, [testFile], added)).toBe('assertion-fail');
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'assertion-fail' })).toBe(
      VERDICT.RED_PROOF_OK,
    );
    // The execution witness re-runs the deciding case with `-t`, so the ROW must be named.
    expect(decidingFailures(json, [testFile], added)).toEqual([
      { file: nameAbs, name: 'sanitizer removes DCS', qualified: true },
    ]);
  });

  it('a new case that FAILS on the reversed source is the proof → assertion-fail', () => {
    const added = new Map([[nameAbs, addedCaseTitleMatchers("+  it('the new case', () => {")]]);
    const json = {
      testResults: [
        {
          name: nameAbs,
          assertionResults: [
            { title: 'the new case', status: 'failed' },
            { title: 'an old case', status: 'passed' },
          ],
        },
      ],
    };
    expect(classifyVitestOutcome(json, [testFile], added)).toBe('assertion-fail');
  });

  it('an OLD case failing while the new one passes is not a proof → added-cases-pass', () => {
    // The masking INFRA-072 was filed for, measured on `2ac10f251..b1f46acf3`: the gate judged at
    // FILE granularity, so any one case failing red-proved the whole file, and a vacuous new
    // regression test beside a pre-existing failing case was invisible. The range's own case is
    // what has to depend on the fix — that is the thing being claimed.
    const added = new Map([[nameAbs, addedCaseTitleMatchers("+  it('the new case', () => {")]]);
    const json = {
      testResults: [
        {
          name: nameAbs,
          assertionResults: [
            { title: 'the new case', status: 'passed' },
            { title: 'an old case', status: 'failed' },
          ],
        },
      ],
    };
    expect(classifyVitestOutcome(json, [testFile], added)).toBe('added-cases-pass');
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'added-cases-pass' })).toBe(
      VERDICT.ACCIDENTAL_GREEN,
    );
  });

  it('judges per FILE: a file the range added nothing to still supplies a proof', () => {
    // The narrowing is within a file, not across the set. A range whose fix is covered by an
    // existing test in one file and by a new test for a different aspect in another is ordinary
    // correct work, and demanding that EVERY deciding file carry a failing new case would fail it.
    // A guard that fires on correct work gets switched off.
    const untouched = 'packages/x/src/b.test.ts';
    const added = new Map([[nameAbs, addedCaseTitleMatchers("+  it('the new case', () => {")]]);
    const json = {
      testResults: [
        { name: nameAbs, assertionResults: [{ title: 'the new case', status: 'passed' }] },
        {
          name: abs(untouched),
          assertionResults: [{ title: 'a case nobody touched', status: 'failed' }],
        },
      ],
    };
    expect(classifyVitestOutcome(json, [testFile, untouched], added)).toBe('assertion-fail');
  });

  it('a range that added no nameable case keeps FILE granularity, and does not fail on it', () => {
    // A regression fixed by EDITING an existing case adds no title this can read. Demanding a new
    // one would fail correct work, and a guard that fires on correct work gets switched off.
    const json = {
      testResults: [
        { name: nameAbs, assertionResults: [{ title: 'an old case', status: 'failed' }] },
      ],
    };
    expect(classifyVitestOutcome(json, [testFile], null)).toBe('assertion-fail');
    expect(classifyVitestOutcome(json, [testFile], new Map())).toBe('assertion-fail');
  });

  it('a run-error still outranks a passing new case → INCONCLUSIVE, never accidental-green (C1)', () => {
    const brokeCollect = 'packages/x/src/b.test.ts';
    const added = new Map([[nameAbs, addedCaseTitleMatchers("+  it('the new case', () => {")]]);
    const json = {
      testResults: [
        {
          name: nameAbs,
          assertionResults: [
            { title: 'the new case', status: 'passed' },
            { title: 'an old case', status: 'failed' },
          ],
        },
        { name: abs(brokeCollect), assertionResults: [] },
      ],
    };
    expect(classifyVitestOutcome(json, [testFile, brokeCollect], added)).toBe('run-error');
  });

  it('through the orchestrator: a vacuous new case beside an old failing one → ACCIDENTAL_GREEN', () => {
    const source = 'packages/x/src/target.ts';
    const test = 'packages/x/src/a.test.ts';
    const files = {
      [abs(test)]: `import { t } from './target.js';`,
      [abs(source)]: 'export const t = 1;',
    };

    return runRegressionRedProof(
      baseIo({
        changedFiles: [source, test],
        readText: (p) => files[p] ?? '',
        fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
        addedTestCaseDiff: () => "+    it('the new regression case', () => {",
        runVitest: () => ({
          testResults: [
            {
              name: abs(test),
              assertionResults: [
                { title: 'the new regression case', status: 'passed' },
                { title: 'a case that was already here', status: 'failed' },
              ],
            },
          ],
        }),
      }),
    ).then(({ verdict, decisions }) => {
      expect(
        verdict,
        'the new case passed with the fix reversed and an older one supplied the red',
      ).toBe(VERDICT.ACCIDENTAL_GREEN);
      expect(decisions[0].outcome).toBe('added-cases-pass');
    });
  });
});

describe('HARNESS-041 pair verdict (C1 + C3)', () => {
  it('not imported (C3) → INCONCLUSIVE regardless of outcome', () => {
    expect(decidePairVerdict({ importsReversedFile: false, outcome: 'all-pass' })).toBe(
      VERDICT.INCONCLUSIVE,
    );
  });
  it('assertion-fail → RED_PROOF_OK', () => {
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'assertion-fail' })).toBe(
      VERDICT.RED_PROOF_OK,
    );
  });
  it('run-error → INCONCLUSIVE, never a pass (C1)', () => {
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'run-error' })).toBe(
      VERDICT.INCONCLUSIVE,
    );
  });
  it('all-pass → ACCIDENTAL_GREEN', () => {
    expect(decidePairVerdict({ importsReversedFile: true, outcome: 'all-pass' })).toBe(
      VERDICT.ACCIDENTAL_GREEN,
    );
  });
});

describe('HARNESS-041 relative-import graph (C3)', () => {
  it('relativeSpecifiers extracts relative imports only', () => {
    const text = `
      import CjkTextInput from '../CjkTextInput.js';
      import { render } from 'ink-testing-library';
      export { x } from './util.js';
    `;
    expect(relativeSpecifiers(text)).toEqual(['../CjkTextInput.js', './util.js']);
  });

  it('relativeSpecifiers captures dynamic import() and ignores commented-out imports', () => {
    const text = `
      const m = await import('./dynamic.js');
      // import ghost from './commented.js';
      /* import block from './block.js'; */
      import real from './real.js';
    `;
    const specs = relativeSpecifiers(text);
    expect(specs).toContain('./dynamic.js');
    expect(specs).toContain('./real.js');
    expect(specs).not.toContain('./commented.js');
    expect(specs).not.toContain('./block.js');
  });

  it('reachableRelativeGraph does not cross into a sibling package sharing a name prefix', () => {
    const pkgRoot = abs('packages/x');
    const testAbs = abs('packages/x/src/a.test.ts');
    const siblingSrc = abs('packages/x-utils/src/leak.ts');
    const files = { [testAbs]: `import { u } from '../../x-utils/src/leak.js';`, [siblingSrc]: '' };
    const read = (p) => files[p] ?? '';
    const exists = (p) => Object.prototype.hasOwnProperty.call(files, p);
    const graph = reachableRelativeGraph([testAbs], pkgRoot, read, exists);
    expect(graph.has(siblingSrc)).toBe(false); // packages/x must not prefix-match packages/x-utils
  });

  it('resolveRelativeImport maps a .js specifier to its .tsx source', () => {
    const importer = abs('packages/x/src/__tests__/a.test.tsx');
    const exists = (p) => p === abs('packages/x/src/CjkTextInput.tsx');
    expect(resolveRelativeImport(importer, '../CjkTextInput.js', exists)).toBe(
      abs('packages/x/src/CjkTextInput.tsx'),
    );
    expect(resolveRelativeImport(importer, 'ink', exists)).toBeNull(); // bare import
  });

  it('reachableRelativeGraph walks relative imports within the package', () => {
    const pkgRoot = abs('packages/x');
    const testAbs = abs('packages/x/src/a.test.ts');
    const srcAbs = abs('packages/x/src/target.ts');
    const files = {
      [testAbs]: `import { t } from './target.js';`,
      [srcAbs]: `export const t = 1;`,
    };
    const read = (p) => files[p] ?? '';
    const exists = (p) => Object.prototype.hasOwnProperty.call(files, p);
    const graph = reachableRelativeGraph([testAbs], pkgRoot, read, exists);
    expect(graph.has(srcAbs)).toBe(true);
    expect(graph.has(testAbs)).toBe(false); // the test file itself is removed
  });
});

// ── Orchestrator through injected seams (the fixture matrix) ─────────────────────────────────────────

function baseIo(overrides = {}) {
  const testFile = 'packages/x/src/a.test.ts';
  const srcFile = 'packages/x/src/target.ts';
  const files = {
    [abs(testFile)]: `import { t } from './target.js';`,
    [abs(srcFile)]: `export const t = 1;`,
  };
  return {
    mergeBase: 'BASE',
    changedFiles: [srcFile, testFile],
    commitSubjects: ['fix: something real'],
    addedFiles: [],
    optOutText: '',
    readText: (p) => files[p] ?? '',
    fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    isDirty: () => false,
    // INFRA-120 — injected like every other git-touching seam. Without it these fixtures would shell
    // out to `git log` for a path that exists only in the fixture, which is the coupling the rest of
    // this helper exists to avoid.
    reversalBase: () => 'BASE',
    reverseApply: () => {},
    restore: () => {},
    runVitest: () => ({ testResults: [] }),
    ...overrides,
  };
}

describe('HARNESS-041 orchestrator fixtures', () => {
  it('genuinely-red: reversed source makes the test fail → RED_PROOF_OK', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({
        runVitest: () => ({
          testResults: [
            { name: abs('packages/x/src/a.test.ts'), assertionResults: [{ status: 'failed' }] },
          ],
        }),
      }),
    );
    expect(verdict).toBe(VERDICT.RED_PROOF_OK);
  });

  it('accidental-green: reversed source, test still passes → ACCIDENTAL_GREEN', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({
        runVitest: () => ({
          testResults: [
            { name: abs('packages/x/src/a.test.ts'), assertionResults: [{ status: 'passed' }] },
          ],
        }),
      }),
    );
    expect(verdict).toBe(VERDICT.ACCIDENTAL_GREEN);
  });

  it('inconclusive-transform-error (C1): vitest could not run → INCONCLUSIVE, not a pass', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ runVitest: () => ({ testResults: [] }) }),
    );
    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
  });

  it('not-imported (C3): test does not import the reversed file → INCONCLUSIVE (never mutates)', async () => {
    let mutated = false;
    const { verdict, decisions } = await runRegressionRedProof(
      baseIo({
        // test imports a different file than the changed source
        readText: (p) =>
          p === abs('packages/x/src/a.test.ts') ? `import { u } from './other.js';` : '',
        reverseApply: () => {
          mutated = true;
        },
      }),
    );
    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(mutated).toBe(false);
    expect(decisions[0].importsReversedFile).toBe(false);
  });

  it('dirty-tree (C4): refuses to mutate, → INCONCLUSIVE', async () => {
    let mutated = false;
    const { verdict } = await runRegressionRedProof(
      baseIo({ isDirty: () => true, reverseApply: () => (mutated = true) }),
    );
    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(mutated).toBe(false);
  });

  it('opt-out: allow-green-at-base marker → SKIPPED_OPT_OUT', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ optOutText: 'allow-green-at-base: unrelated fixture' }),
    );
    expect(verdict).toBe(VERDICT.SKIPPED_OPT_OUT);
  });

  it('not a fix: range → SKIPPED_NOT_FIX', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ commitSubjects: ['feat: new thing'] }),
    );
    expect(verdict).toBe(VERDICT.SKIPPED_NOT_FIX);
  });

  it('no same-package pair → SKIPPED_NO_PAIR', async () => {
    const { verdict } = await runRegressionRedProof(
      baseIo({ changedFiles: ['packages/x/src/target.ts'] }), // source only
    );
    expect(verdict).toBe(VERDICT.SKIPPED_NO_PAIR);
  });

  // ── The hook subject, end to end through the orchestrator (INFRA-071) ────────────────────────
  //
  // A hook is never in a module graph, so before this the C3 check answered "not imported" for
  // every hook pair and the gate returned INCONCLUSIVE — a SKIP wearing another name. These two
  // fixtures pin both halves of the relation that replaces it.
  //
  // The fixture is a real module, not a line of text that looks like one: the relation resolves the
  // spawn through the import binding, so a bare `spawnSync(…)` with nothing importing it is a call
  // to an unknown function and not evidence of anything.
  const SPAWNS_SOME_HOOK = [
    "import { spawnSync } from 'node:child_process';",
    "spawnSync('bash', ['/repo/.claude/hooks/some-hook.sh']);",
  ].join('\n');

  function hookIo(overrides = {}) {
    const testFile = 'scripts/harness/__tests__/some-hook.test.mjs';
    const hook = '.claude/hooks/some-hook.sh';
    return baseIo({
      changedFiles: [hook, testFile],
      readText: () => SPAWNS_SOME_HOOK,
      fileExists: () => true,
      ...overrides,
    });
  }

  it('hook pair: the test spawns it and still passes reversed → ACCIDENTAL_GREEN', async () => {
    const { verdict, decisions } = await runRegressionRedProof(
      hookIo({
        runVitest: () => ({
          testResults: [
            {
              name: abs('scripts/harness/__tests__/some-hook.test.mjs'),
              assertionResults: [{ status: 'passed' }],
            },
          ],
        }),
      }),
    );

    expect(decisions[0].pkg).toBe('.claude/hooks');
    expect(verdict).toBe(VERDICT.ACCIDENTAL_GREEN);
  });

  it('hook pair: an unrelated harness test cannot supply the failure', async () => {
    // Adoption pulls every changed harness test into the hook subject as a CANDIDATE. If all of
    // them were then run and judged, a sibling test that happens to be failing for its own reasons
    // would supply the red proof, and a hook whose test is vacuous would be waved through as
    // `red-proof-ok` — this gate's own failure mode, reintroduced by the widening that was supposed
    // to close it. Only the tests that actually execute the reversed hook may decide.
    const spawner = 'scripts/harness/__tests__/runs-the-hook.test.mjs';
    const bystander = 'scripts/harness/__tests__/unrelated.test.mjs';
    const sources = {
      [abs(spawner)]: SPAWNS_SOME_HOOK,
      [abs(bystander)]: `expect(somethingElse).toBe(1);`,
    };
    let ran = null;

    const { verdict } = await runRegressionRedProof(
      baseIo({
        changedFiles: ['.claude/hooks/some-hook.sh', spawner, bystander],
        readText: (p) => sources[p] ?? '',
        fileExists: () => true,
        runVitest: (_pkg, testFiles) => {
          ran = testFiles;
          return {
            testResults: [
              { name: abs(spawner), assertionResults: [{ status: 'passed' }] },
              { name: abs(bystander), assertionResults: [{ status: 'failed' }] },
            ],
          };
        },
      }),
    );

    expect(ran, 'a test that does not run the hook was handed the verdict').toEqual([spawner]);
    expect(verdict).toBe(VERDICT.ACCIDENTAL_GREEN);
  });

  it('hook pair: a test that only NAMES the hook never mutates the tree', async () => {
    // The other half. Reversing a hook a test does not run would blame it for a failure it had no
    // part in, so the guard has to hold — and it has to hold without touching the working tree.
    let mutated = false;
    const { verdict, decisions } = await runRegressionRedProof(
      hookIo({
        readText: () => `// some-hook.sh is described here, and run nowhere\nexpect(1).toBe(1);`,
        reverseApply: () => {
          mutated = true;
        },
      }),
    );

    expect(verdict).toBe(VERDICT.INCONCLUSIVE);
    expect(decisions[0].importsReversedFile).toBe(false);
    expect(mutated).toBe(false);
  });

  it('judges EACH source, so a proof of one is not a proof of both (INFRA-073)', () => {
    // The aggregation this gate carried from its first version. Every source in a pair was reversed
    // together and judged by ONE outcome, and `assertion-fail` — any deciding test failing — read as
    // RED_PROOF_OK. So a range touching two sources reported the genuine proof of one as the proof
    // of both, and an accidental-green sibling passed unseen: this gate's own defect class, across
    // files instead of within one.
    //
    // Measured on `2ac10f251..b1f46acf3`: three hooks reversed together, exactly one test failing,
    // verdict `red-proof-ok` — silent about the other two.
    const a = 'packages/x/src/proved.ts';
    const b = 'packages/x/src/unproved.ts';
    const testA = 'packages/x/src/proved.test.ts';
    const testB = 'packages/x/src/unproved.test.ts';
    const files = {
      [abs(testA)]: `import { t } from './proved.js';`,
      [abs(testB)]: `import { u } from './unproved.js';`,
      [abs(a)]: 'export const t = 1;',
      [abs(b)]: 'export const u = 1;',
    };
    const reversed = [];

    return runRegressionRedProof(
      baseIo({
        changedFiles: [a, b, testA, testB],
        readText: (p) => files[p] ?? '',
        fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
        reverseApply: (srcs) => reversed.push([...srcs]),
        // `proved` has a test that fails when it is reversed; `unproved` does not.
        runVitest: (_pkg, testFiles) => ({
          testResults: testFiles.map((f) => ({
            name: abs(f),
            assertionResults: [{ status: f === testA ? 'failed' : 'passed' }],
          })),
        }),
      }),
    ).then(({ verdict, decisions }) => {
      expect(
        reversed.map((s) => s.length),
        'the sources were reversed together, so one proof covered both',
      ).toEqual([1, 1]);
      expect(verdict, 'a genuinely red source hid an accidental-green sibling behind it').toBe(
        VERDICT.ACCIDENTAL_GREEN,
      );
      expect(decisions.map((d) => `${d.source}:${d.verdict}`).sort()).toEqual([
        `${a}:${VERDICT.RED_PROOF_OK}`,
        `${b}:${VERDICT.ACCIDENTAL_GREEN}`,
      ]);
    });
  });

  it('hands git a byte-exact patch, final newline included', () => {
    // The defect that made every verdict impossible. The diff was read through the trimming helper,
    // so the patch reached `git apply -R` without its final newline and git rejected it as corrupt —
    // "patch broke at line 60". The gate never got past this line, which is why twelve CI runs
    // produced zero verdicts and nobody could tell a clean examination from no examination at all.
    const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n';
    let received = null;
    defaultReverseApply(
      'BASE',
      ['x'],
      () => diff,
      (_cmd, _args, opts) => {
        received = opts.input;
      },
    );

    expect(received, 'the patch was altered on its way to git').toBe(diff);
    expect(received.endsWith('\n'), 'the final newline was stripped — git calls that corrupt').toBe(
      true,
    );
  });

  it('restores the tree even when vitest throws', async () => {
    let restored = false;
    await runRegressionRedProof(
      baseIo({
        runVitest: () => {
          throw new Error('vitest blew up');
        },
        restore: () => (restored = true),
      }),
    ).catch(() => {});
    expect(restored).toBe(true);
  });
});

describe('what blocks a merge once the gate is enforcing (INFRA-046)', () => {
  /**
   * Promoted on measured evidence, not elapsed time. The 2026-07-25 audit found ZERO substantive
   * verdicts across 40 pull requests — the reverse-apply path had never once executed, so promoting
   * it then would have made a required check out of untested code. After the subject widened to the
   * hooks and the harness, 13 of the last 22 runs produced `red-proof-ok`.
   */
  it('blocks on a proven defect and on nothing else', () => {
    // A test that still passes with the fix reversed guards nothing — a defect whatever else the run
    // found. Every OTHER verdict says what the checker could not establish, and a conclusion never
    // reached must not refuse a merge.
    expect(exitCodeFor(VERDICT.ACCIDENTAL_GREEN, true)).toBe(1);

    for (const verdict of Object.values(VERDICT)) {
      if (verdict === VERDICT.ACCIDENTAL_GREEN) continue;
      expect(exitCodeFor(verdict, true), `${verdict} blocked a merge it cannot judge`).toBe(0);
    }
  });

  it('blocks nothing at all while advisory', () => {
    for (const verdict of Object.values(VERDICT)) {
      expect(exitCodeFor(verdict, false), `${verdict} blocked with enforcement off`).toBe(0);
    }
  });

  it('does not turn its own crash into a merge refusal while advisory', () => {
    // The reasoning this replaces was wrong in a way worth keeping: it said a red here "blocks
    // nothing" because the job is not a required check. In THIS repository that is false. The
    // merge gate refuses on any `mergeStateStatus` other than CLEAN, and GitHub reports UNSTABLE
    // precisely when a NON-required check fails — so an unconditional non-zero on a network
    // hiccup, a bad worktree or a vitest infra failure would push EVERY merge through the manual
    // override until someone fixed it. That is the untested refusal in the merge path this
    // promotion holds required-check membership specifically to avoid, arriving by another door.
    const gate = readFileSync(
      path.resolve(import.meta.dirname, '../../../.claude/hooks/merge-gate.sh'),
      'utf8',
    );
    expect(gate, 'the merge gate no longer refuses a non-CLEAN state — re-decide this').toMatch(
      /"\$STATE" != "CLEAN"/,
    );

    expect(enforceOnCrash({})).toBe(false);
    expect(enforceOnCrash({ REGRESSION_RED_PROOF_ENFORCE: '1' })).toBe(true);
  });

  it('crashes loudly and exits by that switch, as a real invocation', () => {
    // The unit above judges the mapping; this one runs the process, because the mapping is only a
    // policy if the crash path actually reads it. Pointed at a git directory that is not there, the
    // orchestration cannot start — the `.catch` is the code under test.
    const run = (env) => {
      const result = spawnSync(process.execPath, [CHECKER], {
        env: { ...process.env, GIT_DIR: '/nonexistent-red-proof-probe', ...env },
        encoding: 'utf8',
      });
      return { status: result.status, said: `${result.stdout}${result.stderr}` };
    };

    const advisory = run({});
    expect(advisory.status, 'a crash blocked a merge the checker never judged').toBe(0);

    const enforcing = run({ REGRESSION_RED_PROOF_ENFORCE: '1' });
    expect(enforcing.status, 'a crash reported success while enforcing').toBe(1);

    // Silence is not success: whichever way it exits, it must say it could not check. A crash that
    // exits 0 quietly is indistinguishable from "ran and found nothing wrong".
    expect(advisory.said).toMatch(/could not|failed|error/i);
  });

  it('is enforcing in the workflow that runs it', () => {
    // The flag is the promotion. Without this the mapping above is a capability nothing switches on —
    // and a policy that no run applies is the vacuity this harness spends its time removing.
    const ci = readFileSync(
      path.resolve(import.meta.dirname, '../../../.github/workflows/ci.yml'),
      'utf8',
    );
    const job = ci.slice(ci.indexOf('  regression-red-proof:'), ci.indexOf('  patch-coverage:'));

    expect(job).toMatch(/REGRESSION_RED_PROOF_ENFORCE:\s*'1'/);
  });
});

describe('INFRA-120 (issue #1905): a source ADDED in the range', () => {
  it('reverses to the commit that CREATED the file, not to its absence', () => {
    // Reversing to the base deletes the file, so every case importing it throws — and an all-throwing
    // run produces neither `all-pass` nor `added-cases-pass`, the only two outcomes that become
    // ACCIDENTAL_GREEN. The gate cannot report the defect it exists for on anything the range added.
    const log = (args) => {
      if (args[0] === 'cat-file') throw new Error('does not exist at base');
      return 'CREATED\nREVISED\n';
    };
    expect(reversalBaseFor('packages/x/src/new.ts', 'BASE', log)).toBe('CREATED');
  });

  it('returns the base for a file that already existed there', () => {
    const log = (args) => (args[0] === 'cat-file' ? '' : 'ONE\nTWO\n');
    expect(reversalBaseFor('packages/x/src/old.ts', 'BASE', log)).toBe('BASE');
  });

  it('returns null when the range added the file and never revised it', () => {
    // There is genuinely no earlier state. Saying so is the honest answer; reversing to nothing and
    // reading the wreckage would not be.
    const log = (args) => {
      if (args[0] === 'cat-file') throw new Error('does not exist at base');
      return 'CREATED\n';
    };
    expect(reversalBaseFor('packages/x/src/new.ts', 'BASE', log)).toBeNull();
  });

  it('returns the base for a file the range never touched', () => {
    expect(reversalBaseFor('packages/x/src/untouched.ts', 'BASE', () => '')).toBe('BASE');
  });

  it('through the orchestrator: reverses to the creating commit rather than the base', async () => {
    const reversedFrom = [];
    await runRegressionRedProof(
      baseIo({
        reversalBase: () => 'CREATED',
        reverseApply: (paths, from) => reversedFrom.push(from),
        runVitest: () => ({ testResults: [] }),
      }),
    );
    expect(reversedFrom).toEqual(['CREATED']);
  });

  it('the TOP-LEVEL verdict carries it, not just the per-pair decision', async () => {
    // Review finding on the pull request: the `continue` skipped the `worst` update and `rank` had no
    // entry, so a range whose only pair had no earlier state returned the initial `red-proof-ok` —
    // a summary reporting a proof that was never attempted. The same swallowing this change exists
    // to stop, one level up.
    const { verdict, decisions } = await runRegressionRedProof(
      baseIo({ reversalBase: () => null }),
    );
    expect(verdict).toBe(VERDICT.NO_EARLIER_STATE);
    expect(decisions[0].verdict).toBe(VERDICT.NO_EARLIER_STATE);
  });

  it('does not let it outrank a real accidental-green elsewhere in the range', async () => {
    // It sits beside INCONCLUSIVE: both say no verdict was reached. A defect that WAS found must
    // still be what the summary reports.
    const source = 'packages/x/src/target.ts';
    const test = 'packages/x/src/a.test.ts';
    const files = {
      [abs(test)]: `import { t } from './target.js';`,
      [abs(source)]: 'export const t = 1;',
    };
    const { verdict } = await runRegressionRedProof(
      baseIo({
        changedFiles: [source, test],
        readText: (p) => files[p] ?? '',
        fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
        runVitest: () => ({
          testResults: [
            { name: abs(test), assertionResults: [{ title: 'a case', status: 'passed' }] },
          ],
        }),
      }),
    );
    expect(verdict).toBe(VERDICT.ACCIDENTAL_GREEN);
  });

  it('through the orchestrator: no earlier state is REPORTED, not silently inconclusive', async () => {
    let reversed = false;
    const { decisions } = await runRegressionRedProof(
      baseIo({
        reversalBase: () => null,
        reverseApply: () => {
          reversed = true;
        },
      }),
    );
    expect(decisions[0].verdict).toBe(VERDICT.NO_EARLIER_STATE);
    // The point of the branch: it must not reverse to the base and read the resulting throws.
    expect(reversed, 'reversing to the absence of the file is what this avoids').toBe(false);
  });
});
