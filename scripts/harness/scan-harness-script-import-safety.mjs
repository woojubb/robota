#!/usr/bin/env node

/**
 * Importing a harness script must do nothing.
 *
 * WHY THIS EXISTS, measured (HARNESS-065). The 126 scripts under `scripts/harness/` were written in
 * two idioms for direct-execution detection and two for exiting, and the fork was exactly the line
 * between testable and untestable. Counting idioms FOUND the problem; importing every script
 * measured it, and the two answers differed:
 *
 * - **A source heuristic said zero scripts ran work at import.** Importing them all found **ten**.
 * - One of them, `lessons-digest.mjs`, **wrote files** — the digest was regenerated merely by
 *   importing it. Verified by cleaning the tree, importing every script, and diffing.
 * - `scan-release-verification-gate.mjs` ran a whole scan at module scope and ended in
 *   `process.exit(1)`, so importing it could terminate the importing process.
 * - `verify-change.mjs` did not finish within twenty seconds: importing it ran the full verification.
 * - Two more threw on import, because `pathToFileURL(process.argv[1])` rejects `undefined` — so they
 *   could not be imported or tested at all.
 *
 * THE OTHER HALF, and why the guard form matters. Forty scripts detected direct execution with
 * `` import.meta.url === `file://${process.argv[1]}` ``. That comparison breaks when the path
 * contains a character a URL escapes — a space, `#`, anything non-ASCII — and it breaks in the worst
 * direction. MEASURED: a probe script under a directory named `dir with space` printed nothing and
 * exited **0**. `main()` never ran, and a check that did not execute is indistinguishable from a
 * check that passed. `path.resolve` comparison has no such failure; the same probe ran.
 *
 * WHAT IT CHECKS, in three rules, because each hazard is invisible to the others:
 *   1. IMPORT. Every `.mjs` under `scripts/harness/` is imported in its own child process, and must
 *      produce no output, exit 0, and finish quickly. A script that self-executes fails this
 *      whichever idiom it used, and a script that cannot be imported fails it too.
 *   2. GUARD FORM. No script may detect direct execution with a `file://` comparison or with
 *      `pathToFileURL(process.argv[1])`. The first is CONDITIONALLY wrong — correct on an ordinary
 *      path, silently green on one with a space — so rule 1 passes it on this machine, verified by
 *      reinstating the form and watching the scan stay green. A hazard that depends on where the
 *      repository is checked out can only be caught in the source.
 *   3. TEST OWNERSHIP. A coverage declaration names one existing top-level harness module exactly
 *      once and the declaring test must reach it through static imports. A comment cannot turn an
 *      unreferenced module into a tested one.
 *
 * WHAT IT CANNOT DO: it does not check that a script's `main()` is CORRECT, only that importing does
 * not run it. Nor does it verify a script is tested — that is a separate axis, and one this scan is a
 * precondition for rather than a substitute.
 * FAIL-CLOSED: the script directory must exist and contain scripts. Examining nothing cannot pass.
 * Exit code 0 = every script imports silently, 1 = one did work, printed, threw, or hung.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { declaredHarnessCoverage } from './harness-coverage-declarations.mjs';
import { harnessScripts } from './shared.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT_DIR = 'scripts/harness';
const IMPORT_TIMEOUT_MS = 30_000;
const UNTESTED_BASELINE = 'scripts/harness/harness-untested-baseline.json';

/**
 * Import one script in a child process and report what it did.
 *
 * A child per script, rather than one process importing all of them, so the behaviour is ATTRIBUTED.
 * The first attempt imported them in a single process and could see that something printed and
 * something wrote files, but not which — and chasing them one at a time found four before the
 * per-script version found the remaining six in one run.
 */
export function importOutcome(file) {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(file).href)});`],
    { encoding: 'utf8', timeout: IMPORT_TIMEOUT_MS },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status === null)
    return { ok: false, reason: 'did not finish — importing it runs work' };
  if (result.status !== 0) {
    return { ok: false, reason: `exited ${result.status} on import: ${firstLine(output)}` };
  }
  if (output !== '') return { ok: false, reason: `wrote output on import: ${firstLine(output)}` };
  return { ok: true };
}

function appendUntestedBaselineFinding(findings, root, untested) {
  const frozen = loadUntestedBaseline(root);
  if (frozen === undefined) {
    findings.push({
      rule: 'untested-scripts',
      script: SCRIPT_DIR,
      reason: `${untested.length} script(s) have no test and no frozen count — run --write-baseline`,
    });
    return;
  }
  if (untested.length > frozen.length) {
    const added = untested.filter((name) => !frozen.includes(name));
    findings.push({
      rule: 'untested-scripts',
      script: SCRIPT_DIR,
      reason: `${untested.length} script(s) have no test, up from a frozen ${frozen.length} (new: ${added.join(', ')}). An untested check is the leading candidate for one that cannot fail.`,
    });
    return;
  }
  if (untested.length < frozen.length) {
    findings.push({
      rule: 'untested-scripts',
      script: SCRIPT_DIR,
      reason: `the untested count FELL (${frozen.length} → ${untested.length}). Re-freeze it in the SAME change — \`node scripts/harness/scan-harness-script-import-safety.mjs --write-baseline\` — or the gain is a licence to grow back.`,
    });
  }
}

function firstLine(text) {
  return text.split('\n')[0]?.slice(0, 120) ?? '';
}

export function findImportSafetyFindings(root = WORKSPACE_ROOT) {
  const dir = path.join(root, SCRIPT_DIR);
  if (!existsSync(dir)) {
    // Fail closed: no script directory is not "every script is safe".
    throw new Error(
      `harness-script-import-safety: ${SCRIPT_DIR} does not exist under ${root} — nothing could be imported.`,
    );
  }
  // Recursive: `scripts/harness/lib/` holds three shared modules that a top-level read left outside
  // this floor entirely. Review found the same blind spot in the scope-literal ratchet; both are
  // fixed together, because a module under `lib/` can run work on import exactly as one above it can.
  const files = harnessScripts(dir);
  if (files.length === 0) {
    throw new Error(
      `harness-script-import-safety: no .mjs scripts under ${SCRIPT_DIR} in ${root} — nothing could be imported.`,
    );
  }

  const findings = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const outcome = importOutcome(file);
    if (!outcome.ok)
      findings.push({ rule: 'runs-on-import', script: name, reason: outcome.reason });
    const weak = weakGuardReason(readFileSync(file, 'utf8'));
    if (weak !== undefined) findings.push({ rule: 'weak-guard', script: name, reason: weak });
  }
  const coverage = inspectUntestedScripts(dir, files);
  const untested = coverage.untested;
  if (coverage.finding !== null) findings.push(coverage.finding);
  appendUntestedBaselineFinding(findings, root, untested);

  return { findings, examined: files.length, untested };
}

export function untestedScripts(dir, files) {
  const testDir = path.join(dir, '__tests__');
  if (!existsSync(testDir)) return [...files];
  const tests = readdirSync(testDir);
  const declared = declaredHarnessCoverage(testDir, tests);
  return files.filter((name) => {
    const base = path.basename(name).replace(/\.mjs$/, '');
    return !declared.has(name) && !tests.some((test) => test.startsWith(`${base}.`));
  });
}

function inspectUntestedScripts(dir, files) {
  try {
    return { untested: untestedScripts(dir, files), finding: null };
  } catch (error) {
    return {
      untested: [...files],
      finding: {
        rule: 'invalid-coverage-declaration',
        script: path.relative(WORKSPACE_ROOT, path.join(dir, '__tests__')),
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function loadUntestedBaseline(root) {
  const file = path.join(root, UNTESTED_BASELINE);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The second rule, and the one importing cannot reach.
 *
 * A `file://` guard behaves correctly on an ordinary path, so the import check above passes it —
 * verified by reinstating the form on one script and watching the scan stay green. Its danger is
 * conditional on the path, and it fails toward silence: under a directory named `dir with space` a
 * probe printed nothing and exited 0, `main()` never having run. Only a source rule can catch a
 * hazard that is invisible on the machine running the check.
 */
export function weakGuardReason(rawSource) {
  // Comments AND string literals stripped first. A scan must be able to NAME what it forbids, and
  // this one's docstring quotes both banned forms while its own error message spells one out. Without
  // this it reported itself twice — first for the docstring, then for the message — which is the same
  // counting-prose trap the product-identity ratchet hit an hour earlier, met twice in one file.
  //
  // The banned forms are GUARD EXPRESSIONS, so looking only at code is not a narrowing: a guard is
  // never written inside a string.
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  if (/import\.meta\.url\s*===\s*`file:\/\//.test(source)) {
    return "guards direct execution by comparing `import.meta.url` to a `file://` string, which is false whenever the path contains a character a URL escapes — a space, `#`, anything non-ASCII. It fails toward silence: `main()` does not run and the script exits 0, which reads as a pass. Use `path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)`.";
  }
  if (/pathToFileURL\(process\.argv\[1\]\)/.test(source)) {
    return "guards direct execution with `pathToFileURL(process.argv[1])`, which THROWS when `argv[1]` is undefined — so the script cannot be imported at all. Use `path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)`.";
  }
  return undefined;
}

function main() {
  const { findings, examined, untested } = findImportSafetyFindings();
  if (findings.length > 0) {
    process.stderr.write(
      `harness-script-import-safety scan failed: ${findings.length} finding(s):\n`,
    );
    for (const finding of findings) {
      process.stderr.write(`- [${finding.rule}] ${finding.script}: ${finding.reason}\n`);
    }
    process.stderr.write(
      'Guard direct execution with ' +
        "`if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) { main(); }` " +
        'and set `process.exitCode` rather than calling `process.exit()`. A module that works when ' +
        'imported cannot be imported and tested.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `::examined:: ${examined} harness scripts\n` +
      `harness-script-import-safety scan passed (${examined} script(s) imported, ` +
      `${untested.length} without a test at baseline).\n`,
  );
}

function writeBaseline() {
  const { untested } = findImportSafetyFindings();
  writeFileSync(
    path.join(WORKSPACE_ROOT, UNTESTED_BASELINE),
    `${JSON.stringify(untested.sort(), null, 2)}\n`,
  );
  process.stdout.write(`untested-script baseline frozen: ${untested.length} script(s).\n`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
