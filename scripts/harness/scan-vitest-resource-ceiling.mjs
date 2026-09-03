#!/usr/bin/env node

/**
 * Every vitest config in the workspace must inherit the shared resource ceiling
 * (`vitest.shared.ts`), which bounds worker count and — more importantly — how much heap one worker
 * is permitted to hold.
 *
 * ## Why a scan and not a convention
 *
 * On 2026-07-26 an OOM exhausted 23 GB of RAM and 4 GB of swap and the kernel killed the desktop
 * session. It was not a memory leak: a worker's retained heap plateaus near 340 MB and its RSS
 * tracks 1.5x that. Two unbounded quantities multiplied. Process count was one. The other was
 * **heap permission**: V8 derives its limit from system RAM, so on that host each worker was
 * allowed **4144 MB** — measured — and the largest worker the OOM killer reaped was **3.8 GB**,
 * sitting at that ceiling.
 *
 * The ceiling that fixes it lives in one file, but nothing made the other 30 configs use it. Each
 * is an independent `defineConfig` that inherits nothing from the repo root, and a package running
 * without the ceiling gets 4144 MB back — measured directly from inside a worker, before and
 * after:
 *
 * ```
 * without vitest.shared   WORKER_HEAP_LIMIT_MB=4144
 * with vitest.shared      WORKER_HEAP_LIMIT_MB=560
 * ```
 *
 * So the 32nd config, written the way the first 31 were, silently reopens the hole. That is the
 * difference between a convention and an invariant, and it is the only reason this file exists.
 *
 * ## What it checks, and what it deliberately does not
 *
 * Checked: a `vitest.config.*` under a workspace directory imports `vitest.shared` AND passes it to
 * `mergeConfig`. Importing without merging is the failure mode worth catching — it looks correct in
 * review and applies nothing.
 *
 * NOT checked: the numeric values. They are environment-overridable on purpose, so asserting them
 * here would fire on a CI runner that legitimately raises them — and a guard that fires on correct
 * data gets suppressed, which costs more than what it catches.
 *
 * Fails closed: if the shared file is missing, or the walk finds no configs at all, that is a
 * failure and not a pass. A scan that reports success over an empty subject is worse than no scan.
 *
 * Exit code 0 = clean, 1 = violations.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const SHARED_BASENAME = 'vitest.shared';
const WORKSPACE_DIRS = ['packages', 'apps'];
const CONFIG_RE = /^vitest\.config\.(ts|mts|cts|js|mjs|cjs)$/;

/**
 * Find every vitest config under the workspace directories, at ANY depth.
 * Returns absolute paths, sorted. Pure apart from the filesystem read — the unit under test.
 *
 * The depth is deliberately unbounded. The first version walked one level into each workspace
 * directory, which matched `packages/*` and missed `packages/dag-nodes/*` — a real workspace glob
 * in `pnpm-workspace.yaml` holding a real config at
 * `packages/dag-nodes/image-source/vitest.config.ts`. The scan reported "31 configs inherit the
 * ceiling" and was telling the truth about 31 of 32; the missed one still had V8's 4144 MB default.
 *
 * This repository has been bitten by depth-1 walks before — one certified a tree as covered while
 * missing 21 nested packages. Recursing costs nothing here and cannot drift from
 * `pnpm-workspace.yaml` the way a hardcoded depth does.
 */
export function findVitestConfigs(root, workspaceDirs = WORKSPACE_DIRS) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (CONFIG_RE.test(entry.name)) found.push(full);
    }
  };
  for (const wd of workspaceDirs) {
    const base = path.join(root, wd);
    if (existsSync(base)) walk(base);
  }
  return found.sort();
}

/** Remove comments so a MENTION of the ceiling can never stand in for using it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Decide whether one config's source inherits the ceiling.
 * Returns `null` when it does, or a reason string when it does not. Pure — the unit under test.
 *
 * Judged on CODE only. The first version of this matched raw source, so a config carrying
 * `// TODO: adopt vitest.shared` and a commented-out `mergeConfig(resourceCeiling, …)` passed — the
 * defect where a guard is satisfied by a mention instead of a wiring. Comments are stripped first,
 * the import must be a real import statement naming the shared module, and `mergeConfig` must
 * actually receive `resourceCeiling` rather than merely appear somewhere in the file.
 */
export function ceilingViolation(source) {
  const code = stripComments(source);
  const imports = new RegExp(
    `import[\\s\\S]{0,200}?from\\s*['"][^'"]*${SHARED_BASENAME}(\\.[a-z]+)?['"]`,
  ).test(code);
  const mergesCeiling = /\bmergeConfig\s*\(\s*resourceCeiling\b/.test(code);
  const mergesAnything = /\bmergeConfig\s*\(/.test(code);

  if (!imports && !mergesAnything) return `does not import ${SHARED_BASENAME}`;
  if (!imports) return `calls mergeConfig but never imports ${SHARED_BASENAME}`;
  if (!mergesCeiling) {
    return `imports ${SHARED_BASENAME} but never passes resourceCeiling to mergeConfig — no effect`;
  }
  return null;
}

export function findCeilingFindings(root) {
  const findings = [];
  const sharedPresent = ['ts', 'mts', 'js', 'mjs'].some((ext) =>
    existsSync(path.join(root, `${SHARED_BASENAME}.${ext}`)),
  );
  const configs = findVitestConfigs(root);
  if (!sharedPresent) {
    findings.push({
      file: `${SHARED_BASENAME}.ts`,
      reason: 'the shared resource ceiling is missing',
    });
  }
  for (const abs of configs) {
    const reason = ceilingViolation(readFileSync(abs, 'utf8'));
    if (reason) findings.push({ file: path.relative(root, abs), reason });
  }
  return { findings, inspected: configs.length, sharedPresent };
}

function main() {
  const { findings, inspected, sharedPresent } = findCeilingFindings(WORKSPACE_ROOT);

  // An empty subject is a failure, not a pass: a walk that finds nothing has not verified anything.
  if (inspected === 0) {
    process.stdout.write(
      'vitest resource-ceiling scan failed: found no vitest config to inspect — the walk is broken or the workspace layout moved.\n',
    );
    process.exit(1);
  }

  if (findings.length > 0) {
    process.stdout.write('vitest resource-ceiling scan failed:\n');
    for (const f of findings) process.stdout.write(`  - ${f.file}: ${f.reason}\n`);
    process.stdout.write(
      `\nEvery vitest config must inherit ${SHARED_BASENAME}. Without it V8 grants a worker a heap\n` +
        'limit derived from system RAM (measured: 4144 MB on a 23 GB host), which is how the\n' +
        '2026-07-26 OOM took the desktop session down. Shape:\n\n' +
        "  import { defineConfig, mergeConfig } from 'vitest/config';\n" +
        `  import { resourceCeiling } from '<relative>/${SHARED_BASENAME}';\n` +
        '  export default mergeConfig(resourceCeiling, defineConfig({ … }));\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `::examined:: ${inspected} vitest configurations\n` +
      `vitest resource-ceiling scan passed: ${inspected} config(s) inherit the shared ceiling` +
      `${sharedPresent ? '' : ' (WARNING: shared file absent)'}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
