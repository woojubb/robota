import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  WITNESS,
  changedNewLines,
  coverageLines,
  escapeTestNamePattern,
  judgeWitness,
  testNamePattern,
  parseXtrace,
  untraceableShellLines,
  witnessDecidingCases,
  witnessOneCase,
  XTRACE_PRELUDE,
} from '../lib/execution-witness.mjs';

import {
  VERDICT,
  decidingFailures,
  runRegressionRedProof,
} from '../check-regression-red-proof.mjs';

/**
 * INFRA-072 direction 3 — the execution witness.
 *
 * The class this file exists for is the one per-case granularity (#1568) cannot see: a case that
 * FAILS on the reversed source and is accepted as a proof, while the red came from somewhere the fix
 * never touched. Pass/fail cannot tell the two apart; an execution record can.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const abs = (rel) => path.resolve(WORKSPACE_ROOT, rel);

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
function scratchDir(prefix) {
  const dir = makeTemp(prefix);
  scratch.push(dir);
  return dir;
}

// ── The gate-level class: a red that never reached the fix ────────────────────────────────────────

function witnessIo(overrides = {}) {
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
    // INFRA-120 — injected like every other git-touching seam. Without it these fixtures shell out
    // to `git log` for a path that exists only here.
    reversalBase: () => 'BASE',
    reverseApply: () => {},
    restore: () => {},
    addedTestCaseDiff: () => "+    it('the new regression case', () => {",
    runVitest: () => ({
      testResults: [
        {
          name: abs(testFile),
          assertionResults: [{ title: 'the new regression case', status: 'failed' }],
        },
      ],
    }),
    ...overrides,
  };
}

describe('INFRA-072 — a red proof that never reached the fix', () => {
  it('reports red-proof-unreached when the deciding case executed none of the changed lines', async () => {
    // The exact shape the four motivating cases share and pass/fail cannot express: the added case
    // is genuinely RED with the fix reversed, so #1568's rule is satisfied — every added case that
    // must fail did — yet the case never executed a line the fix changed. Its red proves the
    // reversed tree is broken, not that the case depends on the behaviour it names.
    const { verdict, decisions } = await runRegressionRedProof(
      witnessIo({ executionWitness: () => WITNESS.UNREACHED }),
    );

    expect(verdict, 'a red from outside the changed lines was accepted as a proof').toBe(
      VERDICT.PROOF_UNREACHED,
    );
    expect(decisions[0].witness).toBe(WITNESS.UNREACHED);
  });

  it('keeps red-proof-ok when the deciding case did execute a changed line', async () => {
    const { verdict, decisions } = await runRegressionRedProof(
      witnessIo({ executionWitness: () => WITNESS.REACHED }),
    );

    expect(verdict).toBe(VERDICT.RED_PROOF_OK);
    expect(decisions[0].witness).toBe(WITNESS.REACHED);
  });

  it('fails OPEN: an unmeasurable witness leaves the verdict exactly as it was', async () => {
    // A comment-only hunk, a hook run through `sh`, a coverage report that never names the file.
    // None of those is evidence of anything, and a guard that fires on them fires on correct work.
    const { verdict, decisions } = await runRegressionRedProof(
      witnessIo({ executionWitness: () => WITNESS.UNKNOWN }),
    );

    expect(verdict).toBe(VERDICT.RED_PROOF_OK);
    expect(decisions[0].witness).toBe(WITNESS.UNKNOWN);
  });

  it('does not witness an outcome that was never a proof', async () => {
    // `all-pass` is already accidental-green. Running an instrument over it would cost a vitest run
    // to re-confirm a verdict that is settled, and could only make it milder.
    let called = 0;
    const { verdict } = await runRegressionRedProof(
      witnessIo({
        runVitest: () => ({
          testResults: [
            {
              name: abs('packages/x/src/a.test.ts'),
              assertionResults: [{ title: 'the new regression case', status: 'passed' }],
            },
          ],
        }),
        executionWitness: () => {
          called += 1;
          return WITNESS.UNREACHED;
        },
      }),
    );

    expect(verdict).toBe(VERDICT.ACCIDENTAL_GREEN);
    expect(called, 'the instrument ran over a verdict that was already settled').toBe(0);
  });

  it('names the deciding failures, so the instrument runs on the case that supplied the red', () => {
    const testAbs = abs('packages/x/src/a.test.ts');
    const failures = decidingFailures(
      {
        testResults: [
          {
            name: testAbs,
            assertionResults: [
              {
                title: 'unrelated older case',
                fullName: 'x unrelated older case',
                status: 'failed',
              },
              {
                title: 'the new regression case',
                fullName: 'x the new regression case',
                status: 'failed',
              },
            ],
          },
        ],
      },
      ['packages/x/src/a.test.ts'],
      new Map([[testAbs, [/^the new regression case$/]]]),
    );

    // ONLY the added case. An older case's red is not what #1568 accepted as the proof, so it is not
    // what the witness must account for either. `fullName` is space-joined, which is the shape the
    // real reporter emits and the exact string `-t` matches against — measured, not assumed.
    expect(failures).toEqual([
      { file: testAbs, name: 'x the new regression case', qualified: true },
    ]);
  });
});

// ── The instruments ───────────────────────────────────────────────────────────────────────────────

describe('bash execution witness', () => {
  it('records commands reached inside a shell function', () => {
    const dir = scratchDir('xtrace-function-');
    const prelude = path.join(dir, 'prelude.sh');
    const traceFile = path.join(dir, 'trace.log');
    const script = path.join(dir, 'function.sh');
    writeFileSync(prelude, XTRACE_PRELUDE);
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'helper() {',
        '  echo reached',
        '}',
        'helper',
        '',
      ].join('\n'),
    );

    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, BASH_ENV: prelude, HARNESS_XTRACE_FILE: traceFile },
    });

    expect(result.status, `${result.stdout ?? ''}${result.stderr ?? ''}`).toBe(0);
    const executed = parseXtrace(readFileSync(traceFile, 'utf8')).get(script);
    expect(executed, 'the trace never mentioned the script').toBeTruthy();
    expect(executed.has(4), 'the function body was not reported as executed').toBe(true);
    expect(executed.has(6), 'the function call was not reported as executed').toBe(true);
  });

  it('records the branch that ran and NOT the branch that did not', () => {
    // The whole claim in one assertion: a trace that reported both branches would witness a line the
    // case never reached, and the gate built on it would accept every red.
    const dir = scratchDir('xtrace-');
    const prelude = path.join(dir, 'prelude.sh');
    const traceFile = path.join(dir, 'trace.log');
    const script = path.join(dir, 'victim.sh');
    writeFileSync(prelude, XTRACE_PRELUDE);
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'file="$1"',
        'if [[ "$file" == *.ts ]]; then',
        '  echo formatted',
        'else',
        '  echo skipped',
        'fi',
        '',
      ].join('\n'),
    );

    const result = spawnSync('bash', [script, 'notes.txt'], {
      encoding: 'utf8',
      env: { ...process.env, BASH_ENV: prelude, HARNESS_XTRACE_FILE: traceFile },
    });

    expect(result.status, `${result.stdout ?? ''}${result.stderr ?? ''}`).toBe(0);
    const executed = parseXtrace(readFileSync(traceFile, 'utf8')).get(script);
    expect(executed, 'the trace never mentioned the script').toBeTruthy();
    expect([...executed].sort((a, b) => a - b)).toEqual([2, 3, 4, 7]);
    expect(executed.has(5), 'the branch that did not run was reported as executed').toBe(false);
  });

  it('keeps the trace off stderr, which is what these tests assert on', () => {
    const dir = scratchDir('xtrace-stderr-');
    const prelude = path.join(dir, 'prelude.sh');
    const traceFile = path.join(dir, 'trace.log');
    const script = path.join(dir, 'quiet.sh');
    writeFileSync(prelude, XTRACE_PRELUDE);
    writeFileSync(script, '#!/usr/bin/env bash\nset -euo pipefail\necho "on stdout"\n');

    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, BASH_ENV: prelude, HARNESS_XTRACE_FILE: traceFile },
    });

    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('on stdout');
  });

  it('stays inert when the trace file is not requested', () => {
    const dir = scratchDir('xtrace-inert-');
    const prelude = path.join(dir, 'prelude.sh');
    const script = path.join(dir, 'quiet.sh');
    writeFileSync(prelude, XTRACE_PRELUDE);
    writeFileSync(script, '#!/usr/bin/env bash\nset -euo pipefail\necho "on stdout"\n');

    const result = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, BASH_ENV: prelude },
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('witnessOneCase wiring', () => {
  function shellWitness({ targetLines, argv }) {
    const dir = scratchDir('witness-one-');
    const script = path.join(dir, 'hook.sh');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        'set -eu',
        'if [ "${1:-}" = go ]; then',
        '  echo reached',
        'fi',
        '',
      ].join('\n'),
    );
    let seenArgs = null;
    const answer = witnessOneCase({
      workspaceRoot: dir,
      sourceRel: 'hook.sh',
      testFileAbs: '/repo/t.test.mjs',
      caseName: 'a case (with parens)',
      targetLines,
      isShell: true,
      runVitestRaw: (args, env) => {
        seenArgs = args;
        // Stands in for the spawn several processes down that the real prelude instruments.
        spawnSync('bash', [script, ...argv], { env: { ...process.env, ...env } });
      },
    });
    return { answer, seenArgs };
  }

  it('asks vitest for exactly one case, escaping the title it filters on', () => {
    const { seenArgs } = shellWitness({ targetLines: new Set([4]), argv: ['go'] });

    expect(seenArgs).toContain('-t');
    expect(seenArgs[seenArgs.indexOf('-t') + 1]).toBe('^a case \\(with parens\\)$');
  });

  it('REACHED when the only fix-written line is a subshell inside a case arm body', () => {
    // End to end for the review finding, against a real bash run rather than the line classifier:
    // a fix whose single written line is `(cd "$dir" && cmd)` in an arm BODY. `set -x` traces that
    // line, so the honest answer is REACHED — excluding it made the gate report a finding against
    // correct work.
    const dir = scratchDir('witness-subshell-');
    const script = path.join(dir, 'hook.sh');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        'set -eu',
        'case "${1:-}" in',
        '  go)',
        '    (cd "$PWD" && echo ran)',
        '    ;;',
        '  *) ;;',
        'esac',
        '',
      ].join('\n'),
    );

    const answer = witnessOneCase({
      workspaceRoot: dir,
      sourceRel: 'hook.sh',
      testFileAbs: '/repo/t.test.mjs',
      caseName: 'the deciding case',
      targetLines: new Set([5]),
      isShell: true,
      runVitestRaw: (_args, env) => {
        spawnSync('bash', [script, 'go'], { env: { ...process.env, ...env } });
      },
    });

    expect(answer).toBe(WITNESS.REACHED);
  });

  it('does not report a FINDING when the subshell it reached sits beside an unreached line', () => {
    // The variant that shows the actual harm. With the subshell excluded, the only surviving target
    // is a line the case never runs, so the answer is UNREACHED — a finding against correct work,
    // rather than the UNKNOWN the single-line fixture above degrades to.
    const dir = scratchDir('witness-subshell-alarm-');
    const script = path.join(dir, 'hook.sh');
    writeFileSync(
      script,
      [
        '#!/usr/bin/env bash',
        'set -eu',
        'case "${1:-}" in',
        '  go)',
        '    (cd "$PWD" && echo ran)',
        '    ;;',
        '  other)',
        '    echo never-run',
        '    ;;',
        'esac',
        '',
      ].join('\n'),
    );

    const answer = witnessOneCase({
      workspaceRoot: dir,
      sourceRel: 'hook.sh',
      testFileAbs: '/repo/t.test.mjs',
      caseName: 'the deciding case',
      targetLines: new Set([5, 8]),
      isShell: true,
      runVitestRaw: (_args, env) => {
        spawnSync('bash', [script, 'go'], { env: { ...process.env, ...env } });
      },
    });

    expect(answer, 'a line the case DID run was excluded, so the fix read as unreached').toBe(
      WITNESS.REACHED,
    );
  });

  it('isolates the named case even when a SIBLING name contains it', () => {
    // `-t` is an UNANCHORED regex over the full test name, so `parses config` also selects
    // `parses config with defaults` — the ordinary shape of descriptive titles. Every line the
    // sibling touched is then credited to the deciding case, turning a genuine UNREACHED into a
    // reported REACHED. That direction is a MISSED DETECTION: the corpus measurement cannot see it,
    // because nothing looks wrong when the gate wrongly says the proof is sound.
    //
    // This runs a REAL vitest, because the defect IS vitest's `-t` semantics — an injected runner
    // that "implements" `-t` would only test my own idea of what it means.
    const dir = scratchDir('witness-sibling-');
    writeFileSync(
      path.join(dir, 'hook.sh'),
      [
        '#!/usr/bin/env bash',
        'set -eu',
        'if [ "${1:-}" = long ]; then',
        '  echo long-only',
        'fi',
        'echo common',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(dir, 'probe.test.mjs'),
      [
        "import { spawnSync } from 'node:child_process';",
        "import path from 'node:path';",
        "import { describe, expect, it } from 'vitest';",
        "const hook = path.join(import.meta.dirname, 'hook.sh');",
        "const run = (arg) => spawnSync('bash', [hook, arg], { env: { ...process.env } });",
        "describe('outer', () => {",
        // The SHORT name is the deciding case, and it never reaches the fix-written line.
        "  it('parses config', () => { expect(run('short').status).toBe(0); });",
        // The sibling whose name CONTAINS it, and which does reach the line.
        "  it('parses config with defaults', () => { expect(run('long').status).toBe(0); });",
        '});',
        '',
      ].join('\n'),
    );

    const answer = witnessOneCase({
      workspaceRoot: dir,
      sourceRel: 'hook.sh',
      testFileAbs: path.join(dir, 'probe.test.mjs'),
      caseName: 'outer parses config',
      targetLines: new Set([4]), // only `parses config with defaults` executes this
      isShell: true,
      runVitestRaw: (args, env) => {
        spawnSync('npx', ['vitest', 'run', '--root', dir, ...args.slice(1)], {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          env: { ...process.env, ...env },
        });
      },
    });

    expect(answer, 'a sibling case supplied the execution credited to this one').toBe(
      WITNESS.UNREACHED,
    );
  }, 60_000);

  it('REACHED when the case runs the changed line, UNREACHED when it does not', () => {
    expect(shellWitness({ targetLines: new Set([4]), argv: ['go'] }).answer).toBe(WITNESS.REACHED);
    expect(shellWitness({ targetLines: new Set([4]), argv: ['stop'] }).answer).toBe(
      WITNESS.UNREACHED,
    );
  });
});

// ── Pure helpers ──────────────────────────────────────────────────────────────────────────────────

describe('changedNewLines', () => {
  it('numbers the lines the fix WROTE, which are the ones the restored tree has', () => {
    const patch = [
      'diff --git a/x.sh b/x.sh',
      '--- a/x.sh',
      '+++ b/x.sh',
      '@@ -20,4 +20,5 @@',
      ' context',
      '-old one',
      '-old two',
      '+new one',
      '+new two',
      '+new three',
      ' tail',
      '',
    ].join('\n');

    expect([...changedNewLines(patch).get('x.sh')]).toEqual([21, 22, 23]);
  });

  it('gives a pure deletion no target at all — the fix wrote no such line', () => {
    const patch = [
      '--- a/x.sh',
      '+++ b/x.sh',
      '@@ -10,3 +10,2 @@',
      ' context',
      '-removed',
      ' tail',
      '',
    ].join('\n');

    expect([...changedNewLines(patch).get('x.sh')]).toEqual([]);
  });
});

describe('untraceableShellLines', () => {
  it('excludes comments, blanks and the words that close a construct', () => {
    const text = [
      '#!/usr/bin/env bash',
      '',
      'if true; then',
      '  echo hi',
      'else',
      '  echo bye',
      'fi',
      '',
    ].join('\n');
    const untraceable = untraceableShellLines(text);

    expect(untraceable.has(1)).toBe(true); // shebang is a comment
    expect(untraceable.has(2)).toBe(true); // blank
    expect(untraceable.has(5)).toBe(true); // else
    expect(untraceable.has(7)).toBe(true); // fi
    expect(untraceable.has(4)).toBe(false); // a command
  });

  it('excludes a heredoc body, which is data and never a traced command', () => {
    const text = ['cat <<EOF', 'echo not-a-command', 'EOF', 'echo real', ''].join('\n');
    const untraceable = untraceableShellLines(text);

    expect(untraceable.has(2)).toBe(true);
    expect(untraceable.has(4)).toBe(false);
  });

  it('excludes a BARE case arm but not one that carries a command', () => {
    // Probed on bash 5.2, and the distinction is what decides a real range: `"$DIR"/*) ;;` never
    // traces, so counting it executable called a genuine red proof unreached.
    const text = [
      'case "$F" in',
      '  "$DIR"/*) ;;',
      '  *.ts) echo is-ts ;;',
      '  *.md)',
      '    echo is-md',
      '    ;;',
      'esac',
      '',
    ].join('\n');
    const untraceable = untraceableShellLines(text);

    expect(untraceable.has(2), 'a bare arm is grammar, and no trace names it').toBe(true);
    expect(untraceable.has(4), 'a pattern with its body below it is grammar too').toBe(true);
    expect(untraceable.has(3), 'an arm carrying a command traces at its own line').toBe(false);
    expect(untraceable.has(5)).toBe(false);
  });

  it('does NOT exclude a subshell in an arm BODY — `set -x` traces that line', () => {
    // Review finding: the arm pattern matches any `(...)` line with no inner parens, so a full-line
    // subshell in a BODY was excluded from the executable set. If it is the only line a fix wrote
    // inside a case block, the witness reports UNREACHED on a fix the case genuinely reached — a
    // false alarm, and the acceptance criterion for this work promised zero of them.
    const text = ['case "$F" in', '  *.ts)', '    (cd "$dir" && cmd)', '    ;;', 'esac', ''].join(
      '\n',
    );

    expect(untraceableShellLines(text).has(3)).toBe(false);
  });

  it('reads a bare arm only inside a case block', () => {
    // `foo()` outside one is a function header, not an arm, and excluding it would silently drop a
    // real target.
    const text = ['foo()', '{', '  echo hi', '}', ''].join('\n');

    expect(untraceableShellLines(text).has(1)).toBe(false);
  });
});

describe('witnessDecidingCases — the run budget', () => {
  const failures = ['a', 'b', 'c', 'd'].map((name) => ({ file: '/repo/t.test.mjs', name }));

  it('finds a REACHED case that sits past the OLD cap of 3', () => {
    // Review finding: the loop replayed only the first three failures and then fell through to
    // UNREACHED, so a range whose only fix-reaching case is the 4th reported a finding against
    // correct work. Measured across the eight replayed ranges, the deciding-failure counts were
    // 1, 1, 4, 5, 1, 10, 1, 2, 19, 3, 3, 9 — the old cap truncated 5 of 12 sources, so this was live
    // in the real corpus rather than hypothetical. The shipped budget covers the observed maximum.
    const seen = [];
    const answer = witnessDecidingCases({
      failures,
      budget: 25,
      witnessOne: (failure) => {
        seen.push(failure.name);
        return failure.name === 'd' ? WITNESS.REACHED : WITNESS.UNREACHED;
      },
    });

    expect(answer).toBe(WITNESS.REACHED);
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the budget is a hard stop, so a late REACHED beyond it is UNKNOWN and not a finding', () => {
    // The honest reading of a stop: with the walk cut short, the gate does not know whether a later
    // case reached the fix. It must not answer either REACHED (it never saw one) or UNREACHED (it
    // never finished looking).
    const answer = witnessDecidingCases({
      failures,
      budget: 3,
      witnessOne: (failure) => (failure.name === 'd' ? WITNESS.REACHED : WITNESS.UNREACHED),
    });

    expect(answer).toBe(WITNESS.UNKNOWN);
  });

  it('stops at the budget and says UNKNOWN, never UNREACHED', () => {
    // "We stopped looking" and "nothing reached it" are different answers, and only the second is
    // grounds for a finding.
    const answer = witnessDecidingCases({
      failures,
      budget: 2,
      witnessOne: () => WITNESS.UNREACHED,
    });

    expect(answer).toBe(WITNESS.UNKNOWN);
  });

  it('short-circuits on the first REACHED, so a healthy range pays for one run', () => {
    let runs = 0;
    const answer = witnessDecidingCases({
      failures,
      budget: 99,
      witnessOne: () => {
        runs += 1;
        return WITNESS.REACHED;
      },
    });

    expect(answer).toBe(WITNESS.REACHED);
    expect(runs).toBe(1);
  });

  it('UNREACHED only when every deciding failure was actually checked', () => {
    const answer = witnessDecidingCases({
      failures,
      budget: 99,
      witnessOne: () => WITNESS.UNREACHED,
    });

    expect(answer).toBe(WITNESS.UNREACHED);
  });

  it('one unmeasurable case is enough to withhold the finding', () => {
    const answer = witnessDecidingCases({
      failures,
      budget: 99,
      witnessOne: (failure) => (failure.name === 'b' ? WITNESS.UNKNOWN : WITNESS.UNREACHED),
    });

    expect(answer).toBe(WITNESS.UNKNOWN);
  });

  it('a throwing instrument is UNKNOWN, not a finding', () => {
    const answer = witnessDecidingCases({
      failures: [failures[0]],
      budget: 99,
      witnessOne: () => {
        throw new Error('vitest exploded');
      },
    });

    expect(answer).toBe(WITNESS.UNKNOWN);
  });
});

describe('judgeWitness', () => {
  it('UNKNOWN when nothing was measured', () => {
    expect(judgeWitness({ targetLines: new Set([1]), executedLines: null })).toBe(WITNESS.UNKNOWN);
  });

  it('UNKNOWN when no changed line could ever have been reported', () => {
    // A comment-only hunk. Calling this "unreached" would fail correct work.
    expect(
      judgeWitness({
        targetLines: new Set([4]),
        executedLines: new Set([9]),
        executable: new Set([9]),
      }),
    ).toBe(WITNESS.UNKNOWN);
  });

  it('REACHED on any overlap, UNREACHED on none', () => {
    expect(judgeWitness({ targetLines: new Set([4, 5]), executedLines: new Set([5]) })).toBe(
      WITNESS.REACHED,
    );
    expect(judgeWitness({ targetLines: new Set([4, 5]), executedLines: new Set([9]) })).toBe(
      WITNESS.UNREACHED,
    );
  });
});

describe('coverageLines', () => {
  it('separates executed statements from lines that are statements at all', () => {
    const report = {
      '/repo/a.mjs': {
        statementMap: {
          0: { start: { line: 3 }, end: { line: 3 } },
          1: { start: { line: 7 }, end: { line: 7 } },
        },
        s: { 0: 2, 1: 0 },
      },
    };
    const lines = coverageLines(report, '/repo/a.mjs');

    expect([...lines.executed]).toEqual([3]);
    expect([...lines.executable].sort((a, b) => a - b)).toEqual([3, 7]);
  });

  it('returns null for a file the report never mentions', () => {
    expect(coverageLines({}, '/repo/a.mjs')).toBeNull();
  });
});

describe('testNamePattern', () => {
  it('anchors the full name, so a sibling that CONTAINS it is not selected', () => {
    const pattern = new RegExp(testNamePattern('outer parses config'));

    expect(pattern.test('outer parses config')).toBe(true);
    expect(pattern.test('outer parses config with defaults')).toBe(false);
  });

  it('anchors only the END when the describe chain is unknown', () => {
    // `-t` matches the describe-qualified name, so anchoring a BARE title with `^…$` selects
    // nothing at all — measured: `-t '^parses config$'` skipped both cases. When only a title is
    // known the prefix has to stay open, which still excludes the sibling-suffix collision.
    const pattern = new RegExp(testNamePattern('parses config', { qualified: false }));

    expect(pattern.test('outer group parses config')).toBe(true);
    expect(pattern.test('outer group parses config with defaults')).toBe(false);
  });

  it('escapes a title that would otherwise be read as a pattern', () => {
    const pattern = new RegExp(testNamePattern('it (a|b) [c]'));

    expect(pattern.test('it (a|b) [c]')).toBe(true);
    expect(pattern.test('it a')).toBe(false);
  });
});

describe('escapeTestNamePattern', () => {
  it('escapes what vitest would read as a pattern', () => {
    expect(escapeTestNamePattern('it (a|b) [c]')).toBe('it \\(a\\|b\\) \\[c\\]');
  });
});
