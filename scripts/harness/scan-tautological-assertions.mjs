#!/usr/bin/env node

/**
 * Tautological-assertion guard (HARNESS-052).
 *
 * A test whose assertion compares a literal with itself reports a pass over behaviour it never
 * observed. It is the audited "success over work it did not do" shape wearing a test: the suite name
 * claims a behaviour, the suite is green, and the behaviour can be deleted without the suite
 * noticing.
 *
 * MEASURED, not hypothetical. SEC-005 found two of these in `packages/dag-framework` — one of them
 * literally `expect(true).toBe(true)` — and proved both inert by deleting the behaviour under test
 * and watching them stay green. They were repaired in #1443. Nothing stopped the next one being
 * written, and this sweep found two more still live (`packages/agent-core/src/agents/robota.test.ts`
 * and `packages/agent-provider-openai/src/openai/executor-integration.test.ts`), each with a comment
 * next to it stating the claim the assertion cannot check.
 *
 * WHY A SEPARATE SCAN and not a lint rule: the root ESLint config sets `no-unused-vars` to `off` for
 * test files (HARNESS-051 #2), and no rule in the shared config judges an assertion's *content* at
 * all. Test code is the largest body of source in this repo and the least mechanically governed.
 *
 * THE CEILING, stated plainly. This catches assertions that are STRUCTURALLY incapable of failing —
 * a literal compared to itself, a literal asserted to be defined, a length asserted non-negative. It
 * does NOT catch a merely WEAK assertion: a test that asserts a run reached `status === 'success'`
 * while never checking the value the run was supposed to produce is invisible here, and this sweep
 * found several. Weak-assertion detection needs mutation testing (`mutation-nightly.yml`), not a
 * pattern. Do not read a pass from this scan as "the tests assert something useful".
 *
 * Exit code 0 = no tautological assertion found, 1 = violation found.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Trees whose test files are governed. Each must exist — see `assertGovernedTreesPresent`. */
export const SCAN_ROOTS = ['packages', 'apps', 'scripts'];

/** Directory names never walked. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', '.turbo']);

/** A file is governed when it is a test file by any of the repo's naming conventions. */
export function isTestFile(relPath) {
  const norm = relPath.split(path.sep).join('/');
  if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(norm)) return false;
  return /\.(test|spec|bintest)\.[cm]?[jt]sx?$/.test(norm) || norm.includes('/__tests__/');
}

/**
 * The rules. Each `pattern` matches an assertion that cannot fail for any implementation of the code
 * under test. `why` is printed with the finding so the reader does not have to re-derive it.
 *
 * Deliberately NARROW. Every rule here is decidable from the line alone — no data flow, no type
 * information. A rule that needs either would be a rule that misfires, and a guard that misfires
 * gets suppressed, which is how the defect comes back.
 */
export const TAUTOLOGY_RULES = [
  {
    id: 'self-comparison',
    // expect(<literal>).toBe(<the same literal>) and the toEqual/toStrictEqual spellings.
    pattern:
      /\bexpect\(\s*(true|false|null|undefined|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|`[^`$]*`)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\(\s*\1\s*\)/,
    why: 'a literal compared with itself — true for every implementation of the code under test',
  },
  {
    id: 'literal-truthiness',
    pattern: /\bexpect\(\s*(?:true\s*\)\s*\.\s*toBeTruthy|false\s*\)\s*\.\s*toBeFalsy)\(\s*\)/,
    why: 'a literal asserted to have the truthiness it is defined to have',
  },
  {
    id: 'literal-defined',
    pattern:
      /\bexpect\(\s*(?:true|false|null|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBeDefined|not\s*\.\s*toBeUndefined)\(\s*\)/,
    why: 'a literal is always defined — the assertion has no dependency on the code under test',
  },
  {
    id: 'assert-literal',
    pattern: /\bassert(?:\.ok)?\(\s*(?:true|1)\s*[,)]/,
    why: 'a literal truthy value asserted — passes unconditionally',
  },
  {
    id: 'non-negative-length',
    // `.length` is non-negative by construction, so `>= 0` / `> -1` assert nothing.
    pattern:
      /\.length\s*\)\s*\.\s*(?:toBeGreaterThanOrEqual\(\s*0\s*\)|toBeGreaterThan\(\s*-1\s*\))/,
    why: 'a length is never negative — this assertion holds even when the collection is empty',
  },
];

/** Whether a line is a comment or lives inside one. Cheap and deliberately conservative. */
function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * Whether `index` falls inside a string or template literal on this line.
 *
 * Necessary, not cosmetic: this scan's own fixtures — and every future scan's — quote the offending
 * line as data. Flagging a quoted example would make the guard unusable in exactly the files that
 * document it, and a guard that must be suppressed to be adopted is a guard that gets suppressed.
 * Escapes are honoured so `'it\\'s'` does not desynchronise the quote count.
 */
export function isInsideStringLiteral(line, index) {
  let quote;
  for (let i = 0; i < index && i < line.length; i++) {
    const char = line[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (quote === undefined) {
      if (char === "'" || char === '"' || char === '`') quote = char;
    } else if (char === quote) {
      quote = undefined;
    }
  }
  return quote !== undefined;
}

/** Findings in one file's text. Pure, so the unit test can drive it without a fixture tree. */
export function findTautologiesInSource(source, file = 'fixture.test.ts') {
  const findings = [];
  const lines = String(source ?? '').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (isCommentLine(line)) continue;
    for (const rule of TAUTOLOGY_RULES) {
      const match = rule.pattern.exec(line);
      if (match && !isInsideStringLiteral(line, match.index)) {
        findings.push({ file, line: index + 1, rule: rule.id, why: rule.why, text: line.trim() });
      }
    }
  }
  return findings;
}

/** Every governed test file under a root, recursively. */
function walkTestFiles(root, relDir, out) {
  const absolute = path.join(root, relDir);
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkTestFiles(root, path.join(relDir, entry.name), out);
      continue;
    }
    const rel = path.join(relDir, entry.name);
    if (isTestFile(rel)) out.push(rel);
  }
  return out;
}

/**
 * FAIL-CLOSED on a missing governed tree.
 *
 * Returning an empty finding list because `packages/` was not there would be this scan committing
 * the defect it exists to catch. Every root in `SCAN_ROOTS` is mandatory in this repository, so its
 * absence means the scan is running somewhere it cannot judge — which is an error, not a pass.
 */
function assertGovernedTreesPresent(root) {
  const missing = SCAN_ROOTS.filter(
    (dir) => !existsSync(path.join(root, dir)) || !statSync(path.join(root, dir)).isDirectory(),
  );
  if (missing.length > 0)
    throw new Error(
      `governed tree(s) absent: ${missing.join(', ')}. This scan will not report a pass over a tree ` +
        'it could not read.',
    );
}

/** Findings across every governed test file. */
export function findTautologicalAssertions(root = WORKSPACE_ROOT) {
  assertGovernedTreesPresent(root);
  const findings = [];
  for (const dir of SCAN_ROOTS) {
    for (const rel of walkTestFiles(root, dir, [])) {
      findings.push(...findTautologiesInSource(readFileSync(path.join(root, rel), 'utf8'), rel));
    }
  }
  return findings;
}

export function main() {
  const findings = findTautologicalAssertions();
  if (findings.length > 0) {
    process.stdout.write('tautological-assertions scan failed (HARNESS-052):\n');
    for (const finding of findings) {
      process.stdout.write(
        `  - ${finding.file}:${finding.line} [${finding.rule}] ${finding.why}\n`,
      );
      process.stdout.write(`      ${finding.text}\n`);
    }
    process.stdout.write(
      'An assertion that cannot fail makes its suite report a pass over behaviour it never observed.\n' +
        'Assert the OBSERVABLE result the test name claims, or delete the test — there is no\n' +
        'suppression comment for this, deliberately.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('tautological-assertions scan passed.\n');
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  main();
}
