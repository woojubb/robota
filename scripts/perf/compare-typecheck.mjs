#!/usr/bin/env node

/**
 * Compare the legacy TypeScript compiler against the native one (PERF-003 / PERF-004).
 *
 * The adoption criterion for `typecheck` is NOT "the native compiler is faster" — it is "both
 * compilers report the SAME diagnostics". This script keeps that criterion reproducible, so a future
 * compiler bump can be re-judged instead of trusting one session's scrollback.
 *
 * Method: run BOTH compilers against each project's REAL `tsconfig.json` — the same file, the same
 * arguments the project's own `typecheck` script uses — so the compiler is the only variable, then
 * compare the diagnostic lists.
 *
 * PERF-003 could only compare synthesized probe configs, because the native compiler rejected the real
 * ones outright on options TypeScript 7 removed (`baseUrl`, `moduleResolution: node10`,
 * `downlevelIteration`). PERF-004 migrated those away, so the probe is gone: comparing the real config
 * is both simpler and strictly more faithful to what CI runs.
 *
 * Note on `types`: the two compilers do not agree on *automatic* `@types` discovery under pnpm's
 * symlinked `node_modules`. PERF-004 settled that repo-wide by declaring `types` explicitly in the
 * projects that depend on ambient types, rather than by special-casing it here. A new project that
 * leaves `types` unset AND relies on a hoisted `@types/*` package will surface as a mismatch — which is
 * the intended signal, not a false positive.
 *
 * Usage:
 *   pnpm typecheck:compare                    # every workspace project
 *   pnpm typecheck:compare agent-core dag-cli # only projects whose path contains one of these
 *
 * Exit code 0 = every project matched, 1 = at least one differed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Directories whose immediate children are workspace projects (mirrors pnpm-workspace.yaml). */
const PROJECT_PARENTS = [
  'packages',
  'packages/dag-nodes',
  'apps',
  'examples',
  'examples/capabilities',
];

/** A project participates only if it has a tsconfig AND a `typecheck` script that drives a compiler. */
function isComparableProject(dir) {
  const packageJson = path.join(dir, 'package.json');
  if (!existsSync(packageJson) || !existsSync(path.join(dir, 'tsconfig.json'))) return false;
  const script = JSON.parse(readFileSync(packageJson, 'utf8')).scripts?.typecheck;
  return typeof script === 'string' && /\bts(c|go)\b/.test(script);
}

export function findProjects(root = WORKSPACE_ROOT) {
  const found = [];
  for (const parent of PROJECT_PARENTS) {
    const parentDir = path.join(root, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir).sort()) {
      const dir = path.join(parentDir, entry);
      if (!statSync(dir).isDirectory()) continue;
      if (isComparableProject(dir)) found.push(path.relative(root, dir));
    }
  }
  return found;
}

function runCompiler(bin, projectDir) {
  const started = Date.now();
  try {
    execFileSync(
      path.join(WORKSPACE_ROOT, 'node_modules/.bin', bin),
      ['-p', 'tsconfig.json', '--noEmit'],
      { cwd: projectDir, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 },
    );
    return { ms: Date.now() - started, diagnostics: [] };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    return { ms: Date.now() - started, diagnostics: extractDiagnostics(output) };
  }
}

/**
 * Reduce compiler output to a comparable diagnostic identity: file, position, and error code. The
 * MESSAGE text is deliberately dropped — the two compilers word some diagnostics differently while
 * flagging the identical defect, and wording is not what the adoption criterion is about.
 */
export function extractDiagnostics(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /error TS\d+/.test(line))
    .map((line) => {
      const match = /^(.*?)\((\d+),(\d+)\): error (TS\d+)/.exec(line);
      return match ? `${match[1]}(${match[2]},${match[3]}) ${match[4]}` : line;
    })
    .sort();
}

export function compareProject(project) {
  const projectDir = path.join(WORKSPACE_ROOT, project);
  const legacy = runCompiler('tsc', projectDir);
  const native = runCompiler('tsgo', projectDir);
  const onlyLegacy = legacy.diagnostics.filter((d) => !native.diagnostics.includes(d));
  const onlyNative = native.diagnostics.filter((d) => !legacy.diagnostics.includes(d));
  return {
    project,
    legacy,
    native,
    onlyLegacy,
    onlyNative,
    matched: !onlyLegacy.length && !onlyNative.length,
  };
}

export async function main(filters = []) {
  const projects = findProjects().filter(
    (p) => filters.length === 0 || filters.some((f) => p.includes(f)),
  );
  if (projects.length === 0) {
    process.stdout.write('No workspace project matched.\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `typecheck compare — legacy vs native on ${projects.length} real project config(s):\n`,
  );
  const results = [];
  let legacyMs = 0;
  let nativeMs = 0;
  for (const project of projects) {
    const result = compareProject(project);
    results.push(result);
    legacyMs += result.legacy.ms;
    nativeMs += result.native.ms;
    const speedup = (result.legacy.ms / Math.max(result.native.ms, 1)).toFixed(1);
    process.stdout.write(
      `  ${result.matched ? '✓' : '✗'} ${project}: ${result.legacy.diagnostics.length} vs ` +
        `${result.native.diagnostics.length} diagnostic(s), ${result.legacy.ms}ms vs ` +
        `${result.native.ms}ms (${speedup}x)\n`,
    );
    for (const d of result.onlyLegacy) process.stdout.write(`      legacy only: ${d}\n`);
    for (const d of result.onlyNative) process.stdout.write(`      native only: ${d}\n`);
  }

  process.stdout.write(
    `\ntotal compiler time: legacy ${legacyMs}ms, native ${nativeMs}ms ` +
      `(${(legacyMs / Math.max(nativeMs, 1)).toFixed(1)}x)\n`,
  );

  const differing = results.filter((r) => !r.matched);
  if (differing.length > 0) {
    process.stdout.write(
      `${differing.length} of ${results.length} project(s) DISAGREE — the shared typecheck gate must ` +
        'not move to a compiler that reports different diagnostics.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `All ${results.length} project(s) agree — the adoption criterion holds on the real configs.\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main(process.argv.slice(2));
}
