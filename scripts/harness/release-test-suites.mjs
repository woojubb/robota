#!/usr/bin/env node

/**
 * The release sweep's test-suite ENUMERATOR and runner (INFRA-063).
 *
 * THE DEFECT. `pnpm harness:verify:release` — the only substantive required context on
 * `protect-main` — reached the workspace test suites through `pnpm test`, which is
 * `pnpm run -r --if-present test`. `--if-present` matches the script named EXACTLY `test` and walks
 * silently past every other name. A suite declared as `test:bin`, `test:e2e` or `test:pty` is not
 * skipped with a warning; it is never considered.
 *
 * The repository had already met this once and closed it by hand: `harness:verify:release`
 * appended `pnpm --filter @robota-sdk/agent-cli test:bin` as a literal, because that suite exists
 * under a non-`test` name and nothing would otherwise run it. One instance recognised, none
 * generalised — so `packages/agent-cli-web` could declare a `test:e2e` and nothing noticed for as
 * long as it sat there (INFRA-060 D7 found it; it turned out to point at a file that has never
 * existed in this repository's history, which a hand-maintained list also cannot notice).
 *
 * THE SHAPE OF THE FIX. Hand-maintaining a second `--filter` line beside the first is what produced
 * the gap. Instead this module ENUMERATES every workspace script matching `^test(:|$)` and requires
 * each to land in exactly one bucket:
 *
 *   RECURSIVE  the script named exactly `test` — swept by `pnpm test`, no per-package wiring.
 *   EXTRA      run by this module, discovered rather than listed. `test:bin` is here now.
 *   EXCLUDED   declared in EXCLUSIONS below with a KIND and a reason. A named, reasoned exclusion
 *              is honest; silence is not.
 *
 * Nothing may be unclassified: `scan-release-sweep-coverage.mjs` turns a new `test:*` script into a
 * RED scan until someone answers for it. That scan also re-checks each exclusion's claim rather
 * than trusting it — a `covered-elsewhere` entry must name a workflow that really invokes the
 * suite, or the exclusion is a finding.
 *
 * Run directly, this module executes every EXTRA suite in sequence and exits non-zero on the first
 * failure.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** A workspace script that presents itself as a test suite. The whole population this module owns. */
export const TEST_SCRIPT_PATTERN = /^test(:|$)/;

/** The script name `pnpm run -r --if-present <name>` sweeps — the one name `--if-present` matches. */
export const RECURSIVE_SWEEP_SCRIPT = 'test';

/** This module's path, as the release script and the guard both spell it. */
export const RUNNER_PATH = 'scripts/harness/release-test-suites.mjs';

/**
 * Test-named scripts the release sweep deliberately does NOT run, each with the kind of reason and
 * the reason itself. Every entry is re-verified by `scan-release-sweep-coverage.mjs`; an entry that
 * matches no live script is a finding, so this list cannot rot into an allowlist.
 *
 * KINDS, and what each obliges:
 *
 *   `sweep-variant`      the same assertions as the workspace's own `test` script, re-run under a
 *                        different reporter or mode. The workspace MUST also declare `test`, so a
 *                        workspace cannot park its only suite behind a "variant" label.
 *   `covered-elsewhere`  really executed, by a named workflow. The workflow MUST exist and MUST
 *                        invoke the suite. This is the honest answer for a suite too slow or too
 *                        environment-bound for a required promotion gate — the coverage is asserted
 *                        where it actually happens rather than claimed where it does not.
 *   `not-runnable-in-ci` needs credentials, hardware or a toolchain the runner does not have.
 *   `unwired`            declared, and run by no automated gate at all. This is DEBT, not an
 *                        exemption: the count is printed on every pass so it cannot go quiet.
 */
export const EXCLUSIONS = [
  {
    script: 'test:coverage',
    kind: 'sweep-variant',
    why: 'the workspace `test` suite re-run under a coverage reporter — identical assertions, roughly double the wall clock. Coverage has its own entry points (`pnpm test:coverage`, the patch-coverage job); a required promotion gate gains no assertion by running every suite twice.',
  },
  {
    script: 'test:watch',
    kind: 'sweep-variant',
    why: 'the workspace `test` suite in interactive watch mode. It never terminates, so a gate that ran it would hang rather than verify.',
  },
  {
    workspace: 'apps/agent-web',
    script: 'test:ci',
    kind: 'sweep-variant',
    why: '`jest --ci --coverage --watchAll=false` over the same suite `test` (`jest`) runs, which the recursive sweep already executes. Its CI-reporter form is used by deploy.yml.',
  },
  {
    workspace: 'packages/agent-transport-tui',
    script: 'test:pty',
    kind: 'covered-elsewhere',
    workflow: '.github/workflows/ci.yml',
    why: 'the PTY e2e suite drives a real pseudo-terminal against the built binary — the flakiest thing this repository owns, and it needs its own build. It runs as the REQUIRED `tui-e2e` context on every `develop` PR, so every commit a promotion carries has already passed it. Adding it to `protect-main` would re-run a gate already satisfied and put terminal-timing flake in front of every promotion; a required gate that flakes gets bypassed, which costs more than the duplicate coverage is worth.',
  },
  {
    workspace: 'packages/agent-cli',
    script: 'test:bun',
    kind: 'not-runnable-in-ci',
    why: 'guards on `bun` being on PATH and exits 0 when it is not (DIST-001). No CI runner here installs Bun, so putting it in the sweep would add a step that passes without executing anything — precisely the green-over-uncovered-ground this whole item is about.',
  },
  {
    workspace: 'packages/agent-command-workflows',
    script: 'test:live',
    kind: 'not-runnable-in-ci',
    why: 'sets `RUN_LIVE_LLM=1` and calls a real provider. It needs credentials the promotion gate does not hold and bills a vendor per run; its result depends on a third party rather than on the commit.',
  },
  {
    workspace: 'apps/agent-app',
    script: 'test:e2e',
    kind: 'unwired',
    why: 'the Electron desktop e2e (xvfb + a full app build). No workflow invokes it today — measured, not assumed. Wiring it belongs with the desktop release pipeline, not with a promotion gate that would then own an Electron build.',
  },
  {
    workspace: 'apps/agent-app',
    script: 'test:e2e:bundled',
    kind: 'unwired',
    why: 'asserts the PACKAGED runtime, so it needs an electron-builder output no CI job produces on a promotion. No workflow invokes it today. Same owner as `test:e2e` above.',
  },
];

/** Exclusion kinds, and whether each is debt that must stay visible in the pass line. */
export const EXCLUSION_KINDS = {
  'sweep-variant': { debt: false },
  'covered-elsewhere': { debt: false },
  'not-runnable-in-ci': { debt: false },
  unwired: { debt: true },
};

/**
 * Workspace directory globs, read from `pnpm-workspace.yaml` rather than hardcoded.
 *
 * Hardcoding `packages`/`apps` is how `check-nested-package-glob-coverage` had to exist: a scan that
 * knows a subset of the workspace under-covers it silently, which is this module's own subject.
 * Throws when the file is unreadable — a root with no workspace declaration is a root this module
 * cannot judge, never a root with no test scripts.
 */
export function readWorkspaceGlobs(root = WORKSPACE_ROOT) {
  const file = path.join(root, 'pnpm-workspace.yaml');
  if (!existsSync(file))
    throw new Error(
      'pnpm-workspace.yaml is missing — the workspace membership this module enumerates over cannot be read.',
    );
  const globs = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(line);
    if (match) globs.push(match[1]);
  }
  if (globs.length === 0)
    throw new Error('pnpm-workspace.yaml declares no package globs — nothing could be enumerated.');
  return globs;
}

function expandGlob(root, glob) {
  if (!glob.includes('*')) {
    const dir = path.join(root, glob);
    return existsSync(path.join(dir, 'package.json')) ? [dir] : [];
  }
  const [prefix, rest] = glob.split('*');
  if (rest !== '') return []; // only trailing `dir/*` segments are used by this workspace
  const parent = path.join(root, prefix);
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => path.join(parent, entry.name))
    .filter((dir) => existsSync(path.join(dir, 'package.json')));
}

/** Every workspace member's manifest: `{ relativeDir, packageName, scripts }`. */
export function listWorkspaceManifests(root = WORKSPACE_ROOT) {
  const dirs = new Set();
  for (const glob of readWorkspaceGlobs(root))
    for (const dir of expandGlob(root, glob)) dirs.add(dir);
  return [...dirs]
    .sort()
    .map((dir) => {
      const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      return {
        relativeDir: path.relative(root, dir).split(path.sep).join('/'),
        packageName: manifest.name,
        scripts: manifest.scripts ?? {},
      };
    })
    .filter((entry) => typeof entry.packageName === 'string');
}

/** Every workspace-declared script matching `^test(:|$)`, across every workspace member. */
export function collectTestScripts(root = WORKSPACE_ROOT) {
  const found = [];
  for (const manifest of listWorkspaceManifests(root)) {
    for (const [script, command] of Object.entries(manifest.scripts)) {
      if (!TEST_SCRIPT_PATTERN.test(script) || typeof command !== 'string') continue;
      found.push({
        workspace: manifest.relativeDir,
        packageName: manifest.packageName,
        script,
        command,
      });
    }
  }
  return found.sort((a, b) =>
    `${a.workspace}#${a.script}`.localeCompare(`${b.workspace}#${b.script}`),
  );
}

/** The exclusion covering one discovered script, or `undefined`. */
export function exclusionFor(entry) {
  return EXCLUSIONS.find(
    (exclusion) =>
      exclusion.script === entry.script &&
      (exclusion.workspace === undefined || exclusion.workspace === entry.workspace),
  );
}

/**
 * Every discovered test script sorted into exactly one bucket.
 *
 * `unclassified` is always empty in a healthy tree; it exists so the guard has something to report
 * rather than this module having somewhere to hide a script it does not know about.
 */
export function classifyTestScripts(root = WORKSPACE_ROOT) {
  const recursive = [];
  const extra = [];
  const excluded = [];
  for (const entry of collectTestScripts(root)) {
    if (entry.script === RECURSIVE_SWEEP_SCRIPT) {
      recursive.push(entry);
      continue;
    }
    const exclusion = exclusionFor(entry);
    if (exclusion) {
      excluded.push({ ...entry, exclusion });
      continue;
    }
    extra.push(entry);
  }
  return { recursive, extra, excluded, unclassified: [] };
}

/**
 * The file a test command executes, when the command names one plainly.
 *
 * Two shapes cover every suite here: `node <path>` (optionally behind a wrapper such as `xvfb-run`)
 * and `--config <path>`. A script naming a file that does not exist is dead — which is what
 * `packages/agent-cli-web`'s `test:e2e` was, undetectably, for as long as a hand-maintained list
 * was the only thing looking.
 */
export function referencedEntryFile(command) {
  const config = /--config[= ]([^\s]+)/.exec(command);
  if (config) return config[1];
  const node = /(?:^|\s)node\s+([^\s-][^\s]*)/.exec(command);
  if (node) return node[1];
  return undefined;
}

export async function main() {
  const { recursive, extra, excluded } = classifyTestScripts();
  const debt = excluded.filter((entry) => EXCLUSION_KINDS[entry.exclusion.kind]?.debt).length;

  process.stdout.write(
    `release extra test suites: ${extra.length} to run ` +
      `(${recursive.length} swept by \`pnpm test\`, ${excluded.length} excluded by declaration, ` +
      `${debt} of those unwired debt).\n`,
  );

  for (const entry of extra) {
    process.stdout.write(`\n> ${entry.packageName} ${entry.script}\n`);
    const result = spawnSync('pnpm', ['--filter', entry.packageName, 'run', entry.script], {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      process.stdout.write(
        `\nrelease extra test suites: ${entry.packageName} ${entry.script} FAILED ` +
          `(exit ${result.status ?? 'signal ' + result.signal}).\n`,
      );
      process.exitCode = result.status === 0 ? 1 : (result.status ?? 1);
      return;
    }
  }

  process.stdout.write(`\nrelease extra test suites: ${extra.length} suite(s) passed.\n`);
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
