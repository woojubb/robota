/**
 * INFRA-072 — direction 3: an execution witness for the case that supplies a red proof.
 *
 * `check-regression-red-proof` reads pass/fail and nothing else. A case that fails on the reversed
 * source is accepted as a proof even when its red came from somewhere the fix never touched — the
 * "fails for the WRONG REASON" half of INFRA-072. The relation the gate uses to decide which tests
 * may judge (`reachableRelativeGraph` for a module, the spawn call graph for a hook) is STATIC: it
 * says the test COULD reach the source, never that it DID. That is PROC-003's third question — "is
 * it reached?" — left unasked of the gate's own premise.
 *
 * This module answers it by observation. Two subjects, two instruments, one question:
 *
 *   - a `bash` script is traced with `BASH_XTRACEFD`. `BASH_ENV` names a prelude every
 *     non-interactive bash sources before the script it was asked to run, so the instrument reaches
 *     a hook the gate never spawns itself — the test spawns it, several processes down. `PS4` is set
 *     to `@${BASH_SOURCE}:${LINENO}@`, and the trace goes to its OWN descriptor, so a test asserting
 *     on the hook's stderr is unaffected by being measured.
 *   - a `.mjs`/`.ts` module is measured with vitest's v8 coverage, whose istanbul-shaped output
 *     names the executed statements and, just as importantly, WHICH lines are statements at all.
 *
 * FAIL OPEN, always. Three answers, and only `UNREACHED` is a finding: a comment-only hunk, a hook
 * run through `sh`, a coverage report that never mentions the file — each of those is UNKNOWN, and
 * an unknown must never turn a genuine proof into an alarm. A guard that fires on correct work gets
 * switched off.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const WITNESS = Object.freeze({
  REACHED: 'reached', // the deciding case executed a line the fix changed
  UNREACHED: 'unreached', // it executed none of them — its red came from elsewhere
  UNKNOWN: 'unknown', // nothing measurable; never a finding
});

// ── Pure: what the fix wrote ──────────────────────────────────────────────────────────────────────

/**
 * NEW-side line numbers a unified diff writes, per file — the lines the fix put there.
 *
 * The first formulation targeted the OLD side and ran on the reversed tree, and it was measured
 * wrong on the two real ranges available. Most fixes are ADDITIONS: `c08e0dbd6` added a stand-down
 * guard, so its old side held nothing but the comment it replaced and one `case` pattern arm, and
 * the question "did the case reach the pre-fix line" had almost no line to ask about. Asked of the
 * FIXED tree it is well posed for exactly the fixes that dominate — did the deciding case execute
 * the code this fix WROTE? — and it is the question the gate's premise actually needs answered.
 *
 * A pure DELETION contributes nothing here, symmetrically, and the judge reads an empty target as
 * UNKNOWN rather than as a failure to reach.
 */
export function changedNewLines(patchText) {
  const byFile = new Map();
  let current = null;
  let newLine = 0;
  for (const line of String(patchText ?? '').split('\n')) {
    const fileMatch = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (fileMatch && !line.startsWith('+++ /dev/null')) {
      current = fileMatch[1].trim();
      if (!byFile.has(current)) byFile.set(current, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!current || newLine === 0) continue;
    if (line.startsWith('+')) {
      byFile.get(current).add(newLine);
      newLine += 1;
    } else if (line.startsWith(' ') || line === '') {
      newLine += 1;
    }
    // `-` lines advance only the old side, and `\ No newline` advances neither.
  }
  return byFile;
}

/**
 * Lines a shell trace can never report, so that their absence is not read as "not reached".
 *
 * `set -x` prints a line when a COMMAND runs. Blanks and comments are neither; `fi`, `esac`, `else`,
 * `done`, `then`, `do` and a bare brace are grammar; a heredoc body is data.
 *
 * And a BARE `case` ARM — a pattern, its `)`, and at most a `;;` — is grammar too. That one is not a
 * guess: probed on bash 5.2, `*.ts) echo is-ts ;;` traces at its own line because it carries a
 * command, while `*.md)` alone never traces and only its body does. It matters because it is exactly
 * the shape `post-tool-format.sh` changed — `"${CLAUDE_PROJECT_DIR:-}"/*) ;;` — and counting it as
 * executable called a genuine red proof `unreached` on the only real range there was to measure.
 *
 * An arm is recognised by POSITION, not by shape alone, and the shape test is not enough on its own:
 * `(cd "$dir" && cmd)` is a full-line subshell that satisfies the same pattern, `set -x` DOES trace
 * it, and excluding it made a fix whose only written line was that subshell read as unreached — a
 * finding against correct work. Arm position is where the grammar allows a new arm: straight after
 * `case … in`, and after each `;;` / `;&` / `;;&`. Everything between those is a BODY, where a
 * parenthesised line is a command. The state is a stack, so a `case` nested inside an arm body does
 * not reset the block that encloses it.
 */
export function untraceableShellLines(sourceText) {
  const lines = String(sourceText ?? '').split('\n');
  const untraceable = new Set();
  const GRAMMAR = new Set(['fi', 'esac', 'else', 'done', 'then', 'do', '{', '}', '(', ')', ';;']);
  const BARE_CASE_ARM = /^\(?[^()]*\)\s*(?:;;&?|;&)?$/;
  const OPENS_ARM = /^\(?[^()]*\)/;
  const ARM_TERMINATOR = /(?:;;&?|;&)$/;
  let heredocTerminator = null;
  /** One entry per open `case … in`; the value is "the next line may be an arm". */
  const caseStack = [];
  const expectingArm = () => caseStack.length > 0 && caseStack[caseStack.length - 1];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();
    if (heredocTerminator !== null) {
      untraceable.add(lineNo);
      if (trimmed === heredocTerminator) heredocTerminator = null;
      continue;
    }
    const heredoc = raw.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*$/);
    if (heredoc) heredocTerminator = heredoc[1];

    const atArmPosition = expectingArm();
    if (trimmed === '' || trimmed.startsWith('#') || GRAMMAR.has(trimmed)) untraceable.add(lineNo);
    else if (atArmPosition && BARE_CASE_ARM.test(trimmed)) untraceable.add(lineNo);

    if (/^case\s.*\sin$/.test(trimmed)) caseStack.push(true);
    else if (trimmed === 'esac' && caseStack.length > 0) caseStack.pop();
    else if (caseStack.length > 0) {
      // A terminator hands the next line back to arm position; an arm that did not terminate on its
      // own line has opened a body, and every line until the next terminator is a command.
      if (ARM_TERMINATOR.test(trimmed)) caseStack[caseStack.length - 1] = true;
      else if (atArmPosition && OPENS_ARM.test(trimmed)) caseStack[caseStack.length - 1] = false;
    }
  }
  return untraceable;
}

/** Parse the `@<abs path>:<line>@ …` records this module's PS4 emits. */
export function parseXtrace(traceText) {
  const byFile = new Map();
  for (const line of String(traceText ?? '').split('\n')) {
    const m = line.match(/@(\/[^:@]*):(\d+)@/);
    if (!m) continue;
    const [, file, lineNo] = m;
    if (!byFile.has(file)) byFile.set(file, new Set());
    byFile.get(file).add(Number(lineNo));
  }
  return byFile;
}

/**
 * Executed lines, and the lines that are statements at all, from one file's istanbul-shaped entry.
 * Returns null when the report does not mention the file — which is UNKNOWN, not "nothing ran".
 */
export function coverageLines(coverageJson, absPath) {
  const entry = coverageJson?.[absPath];
  if (!entry?.statementMap) return null;
  const executed = new Set();
  const executable = new Set();
  for (const [id, loc] of Object.entries(entry.statementMap)) {
    const start = loc?.start?.line;
    const end = loc?.end?.line ?? start;
    if (typeof start !== 'number') continue;
    for (let l = start; l <= end; l += 1) {
      executable.add(l);
      if ((entry.s?.[id] ?? 0) > 0) executed.add(l);
    }
  }
  return { executed, executable };
}

/**
 * The verdict for one (deciding case, changed source) pair.
 *
 * `targetLines` are the fix's new-side lines; `executable`, when known, narrows them to lines an
 * instrument could ever have reported. An empty target after narrowing is UNKNOWN — a fix made
 * entirely of comments, or of pure deletions, is unwitnessable, and saying so is honest where
 * calling it unreached would be an alarm on correct work.
 */
export function judgeWitness({ targetLines, executedLines, executable = null }) {
  if (!executedLines) return WITNESS.UNKNOWN;
  const targets = [...(targetLines ?? [])].filter((l) => executable === null || executable.has(l));
  if (targets.length === 0) return WITNESS.UNKNOWN;
  return targets.some((l) => executedLines.has(l)) ? WITNESS.REACHED : WITNESS.UNREACHED;
}

// ── Impure: run one case under instrumentation ────────────────────────────────────────────────────

/**
 * Sourced by every non-interactive bash before the script it was invoked with, so a hook spawned
 * from inside a vitest worker is traced without the gate touching the test or the hook.
 *
 * The descriptor is opened by `exec {fd}>>`, appended to, and named through `BASH_XTRACEFD` so the
 * trace never lands on stderr — the stream several of these tests assert on.
 */
export const XTRACE_PRELUDE = `if [ -n "\${HARNESS_XTRACE_FILE:-}" ]; then
  exec {__harness_xtrace_fd}>>"\$HARNESS_XTRACE_FILE"
  BASH_XTRACEFD=\$__harness_xtrace_fd
  PS4='@\${BASH_SOURCE}:\${LINENO}@ '
  set -x
fi
`;

/** vitest's `-t` is a regular expression; a title is a literal. */
export function escapeTestNamePattern(title) {
  return String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ask the question of every deciding case, and never let "we stopped looking" pass for "nothing
 * reached it".
 *
 * The budget is a COST STOP, not a sample. It exists because each answer costs a vitest run, and the
 * expensive path is the one where no case reaches the fix — a REACHED short-circuits on the first
 * hit, so a healthy range pays for one run whatever the budget is. Exhausting it therefore only ever
 * happens on the way to a finding, which is the moment the gate most needs to be right.
 *
 * So an exhausted budget answers UNKNOWN. UNREACHED is reserved for the case where every deciding
 * failure was actually checked and not one of them ran a line the fix wrote — the only situation in
 * which the gate has grounds to say the red came from outside the fix.
 *
 * @param witnessOne (failure) => WITNESS — injected so the budget rule is tested without vitest.
 */
export function witnessDecidingCases({ failures, budget, witnessOne }) {
  if (!failures?.length) return WITNESS.UNKNOWN;
  let sawUnknown = false;
  let checked = 0;
  for (const failure of failures) {
    // Stopped looking. Reporting UNREACHED here would be a finding built on the cases nobody ran.
    if (checked >= budget) return WITNESS.UNKNOWN;
    checked += 1;
    let answer;
    try {
      answer = witnessOne(failure);
    } catch {
      answer = WITNESS.UNKNOWN;
    }
    if (answer === WITNESS.REACHED) return WITNESS.REACHED;
    if (answer === WITNESS.UNKNOWN) sawUnknown = true;
  }
  return sawUnknown ? WITNESS.UNKNOWN : WITNESS.UNREACHED;
}

/**
 * Run ONE case and judge whether it executed the fix's own lines in `sourceRel`.
 *
 * Isolating the case is what makes the answer per-case: vitest's json reporter attributes outcomes
 * to cases but coverage to a run, so the run is narrowed to the single case instead.
 *
 * @param runVitestRaw (args, env) => void — injected so this is exercised without a vitest install.
 */
export function witnessOneCase({
  workspaceRoot,
  sourceRel,
  testFileAbs,
  caseName,
  targetLines,
  isShell,
  readText = (p) => readFileSync(p, 'utf8'),
  runVitestRaw,
}) {
  const sourceAbs = path.resolve(workspaceRoot, sourceRel);
  const scratch = mkdtempSync(path.join(tmpdir(), 'harness-witness-'));
  try {
    const pattern = escapeTestNamePattern(caseName);
    if (isShell) {
      const prelude = path.join(scratch, 'xtrace-prelude.sh');
      const traceFile = path.join(scratch, 'xtrace.log');
      writeFileSync(prelude, XTRACE_PRELUDE);
      writeFileSync(traceFile, '');
      runVitestRaw([testFileAbs, '-t', pattern], {
        BASH_ENV: prelude,
        HARNESS_XTRACE_FILE: traceFile,
      });
      const executed = parseXtrace(readText(traceFile)).get(sourceAbs) ?? null;
      let sourceText = null;
      try {
        sourceText = readText(sourceAbs);
      } catch {
        return WITNESS.UNKNOWN; // an unreadable source cannot be narrowed OR widened honestly
      }
      const untraceable = untraceableShellLines(sourceText);
      return judgeWitness({
        targetLines,
        executedLines: executed,
        executable: { has: (l) => !untraceable.has(l) },
      });
    }

    const reportDir = path.join(scratch, 'coverage');
    runVitestRaw(
      [
        testFileAbs,
        '-t',
        pattern,
        '--coverage.enabled',
        '--coverage.provider=v8',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=${reportDir}`,
        '--coverage.all=false',
      ],
      {},
    );
    let report;
    try {
      report = JSON.parse(readText(path.join(reportDir, 'coverage-final.json')));
    } catch {
      return WITNESS.UNKNOWN; // no report is no evidence
    }
    const lines = coverageLines(report, sourceAbs);
    if (!lines) return WITNESS.UNKNOWN; // the report never mentioned the file
    // No widening here: istanbul's statementMap names the statements exactly, so a changed line that
    // is not one is EXCLUDED rather than approximated, and the answer stays sharp.
    return judgeWitness({
      targetLines,
      executedLines: lines.executed,
      executable: lines.executable,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The default raw vitest invocation for a witness run — same shape the gate already uses. */
export function defaultRunVitestRaw(workspaceRoot, pkg) {
  const isWorkspacePackage = /^(?:packages|apps)\//.test(pkg);
  return (args, env) => {
    const invocation = isWorkspacePackage
      ? ['--filter', `./${pkg}`, 'exec', 'vitest', 'run', ...args]
      : ['exec', 'vitest', 'run', ...args];
    try {
      execFileSync('pnpm', invocation, {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
    } catch {
      // A failing case is the EXPECTED outcome here — the witness runs on the reversed source, where
      // the deciding case is red. The instrument's output is what matters, not the exit code.
    }
  };
}
