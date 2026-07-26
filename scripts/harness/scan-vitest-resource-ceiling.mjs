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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SHARED_BASENAME = 'vitest.shared';
const WORKSPACE_DIRS = ['packages', 'apps'];
const CONFIG_RE = /^vitest\.config\.(ts|mts|cts|js|mjs|cjs)$/;

/**
 * Find every vitest config under the workspace directories, one level into each workspace and the
 * workspace directory itself (`packages/vitest.config.ts` is a real config in this repo).
 * Returns absolute paths, sorted. Pure apart from the filesystem read — the unit under test.
 */
export function findVitestConfigs(root, workspaceDirs = WORKSPACE_DIRS) {
  const found = [];
  const consider = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (CONFIG_RE.test(entry)) found.push(path.join(dir, entry));
    }
  };
  for (const wd of workspaceDirs) {
    const base = path.join(root, wd);
    if (!existsSync(base)) continue;
    consider(base);
    for (const entry of readdirSync(base)) {
      if (entry === 'node_modules') continue;
      const child = path.join(base, entry);
      let st;
      try {
        st = statSync(child);
      } catch {
        continue;
      }
      if (st.isDirectory()) consider(child);
    }
  }
  return found.sort();
}

/**
 * Decide whether one config's source inherits the ceiling.
 * Returns `null` when it does, or a reason string when it does not. Pure — the unit under test.
 */
export function ceilingViolation(source) {
  const imports = source.includes(SHARED_BASENAME);
  const merges = /\bmergeConfig\s*\(/.test(source);
  if (!imports && !merges) return `does not import ${SHARED_BASENAME}`;
  if (!imports) return `calls mergeConfig but never imports ${SHARED_BASENAME}`;
  if (!merges) return `imports ${SHARED_BASENAME} but never passes it to mergeConfig — no effect`;
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
    `vitest resource-ceiling scan passed: ${inspected} config(s) inherit the shared ceiling` +
      `${sharedPresent ? '' : ' (WARNING: shared file absent)'}.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
