#!/usr/bin/env node

/**
 * Compare the legacy TypeScript compiler against the native one (PERF-003).
 *
 * The adoption criterion for switching `typecheck` is NOT "the native compiler is faster" — it is
 * "both compilers report the SAME diagnostics". This script makes that comparison reproducible so
 * PERF-004 can re-run it after the tsconfig migration, instead of it living in one session's scrollback.
 *
 * Method: for each target package, synthesize a self-contained probe tsconfig — the package's own
 * options merged over the base, minus the options the native compiler removed (`baseUrl`,
 * `downlevelIteration`, `paths`) and with `moduleResolution` set to a supported value. Run both
 * compilers against that identical config so the COMPILER is the only variable, then diff their output.
 *
 * Why the probe needs `types` set explicitly: the two compilers do not agree on *automatic* `@types`
 * discovery under pnpm's symlinked `node_modules`. With `types` unset, the legacy compiler picks up the
 * hoisted `@types/jest` (supplying `describe`/`it`/`expect` to vitest files) and the native one does not,
 * producing dozens of phantom "Cannot find name" errors that are a resolution difference, not a code
 * disagreement. Pinning `types` isolates the comparison to real diagnostics. PERF-004 must decide the
 * repo-wide answer for this (explicit `types`, or a different `@types` layout).
 *
 * Exit code 0 = every target matched, 1 = at least one differed (or a compiler was missing).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Options the native compiler removed — a probe carrying them fails on config, never reaching the code. */
const REMOVED_OPTIONS = ['baseUrl', 'downlevelIteration', 'paths'];
/** Project-graph options that make a standalone probe meaningless. */
const PROJECT_OPTIONS = ['composite', 'incremental', 'tsBuildInfoFile'];

/** Packages compared by default. Override with CLI args: `pnpm typecheck:compare agent-core agent-cli`. */
const DEFAULT_TARGETS = [
  'agent-core',
  'agent-framework',
  'agent-tools',
  'agent-session',
  'agent-cli',
];

/** Strip `//` comments so `tsconfig` files parse as JSON. Deliberately naive — these are our own files. */
function readJsonc(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
}

export function buildProbeConfig(baseConfig, packageConfig) {
  const compilerOptions = {
    ...(baseConfig.compilerOptions ?? {}),
    ...(packageConfig.compilerOptions ?? {}),
  };
  for (const key of [...REMOVED_OPTIONS, ...PROJECT_OPTIONS]) delete compilerOptions[key];
  compilerOptions.moduleResolution = 'bundler';
  // See the header: automatic @types discovery diverges between the compilers under pnpm.
  compilerOptions.types = ['node', 'jest'];
  return {
    compilerOptions,
    include: packageConfig.include ?? ['src'],
    exclude: packageConfig.exclude ?? [],
  };
}

function runCompiler(bin, projectFile, cwd) {
  const started = Date.now();
  try {
    execFileSync('npx', [bin, '-p', projectFile, '--noEmit'], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ms: Date.now() - started, output: '' };
  } catch (error) {
    return { ms: Date.now() - started, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

export function compareTarget(pkg) {
  const packageDir = path.join(WORKSPACE_ROOT, 'packages', pkg);
  const probe = buildProbeConfig(
    readJsonc(path.join(WORKSPACE_ROOT, 'tsconfig.base.json')),
    readJsonc(path.join(packageDir, 'tsconfig.json')),
  );

  // Written inside the package so relative `include`/`extends`-free paths resolve as they normally would.
  const probeFile = path.join(packageDir, 'tsconfig.perf-compare.json');
  writeFileSync(probeFile, `${JSON.stringify(probe, null, 2)}\n`);
  try {
    const legacy = runCompiler('tsc', 'tsconfig.perf-compare.json', packageDir);
    const native = runCompiler('tsgo', 'tsconfig.perf-compare.json', packageDir);
    return { pkg, legacy, native, matched: legacy.output === native.output };
  } finally {
    rmSync(probeFile, { force: true });
  }
}

export async function main(targets = DEFAULT_TARGETS) {
  const results = [];
  for (const pkg of targets) results.push(compareTarget(pkg));

  process.stdout.write('typecheck compare — legacy vs native (diagnostics must match):\n');
  for (const { pkg, legacy, native, matched } of results) {
    const speedup = legacy.ms > 0 ? (legacy.ms / Math.max(native.ms, 1)).toFixed(1) : '?';
    process.stdout.write(
      `  ${matched ? '✓' : '✗'} ${pkg}: legacy ${legacy.ms}ms, native ${native.ms}ms (${speedup}x) — ` +
        `${matched ? 'diagnostics identical' : 'DIAGNOSTICS DIFFER'}\n`,
    );
    if (!matched) {
      process.stdout.write(`      legacy:\n${legacy.output || '        (none)'}\n`);
      process.stdout.write(`      native:\n${native.output || '        (none)'}\n`);
    }
  }

  const differing = results.filter((r) => !r.matched);
  if (differing.length > 0) {
    process.stdout.write(
      `\n${differing.length} of ${results.length} target(s) disagree — do NOT switch the typecheck ` +
        'entry point until they match (PERF-003 adoption criterion).\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `\nAll ${results.length} target(s) agree. Remaining gate before switching: the tsconfig migration ` +
      '(PERF-004) — the native compiler rejects the real configs outright until then.\n',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  const args = process.argv.slice(2);
  await main(args.length > 0 ? args : DEFAULT_TARGETS);
}
