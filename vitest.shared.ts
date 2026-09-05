import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The resource ceiling every vitest config in this repo inherits.
 *
 * ## Why this file exists
 *
 * An OOM on 2026-07-26 exhausted 23 GB of RAM and 4 GB of swap and the kernel killed the desktop
 * session. It was not a memory leak — measured across all 796 test files, a worker's retained heap
 * plateaus near 340 MB and its RSS tracks 1.5x that. Two unbounded quantities multiplied instead:
 *
 * 1. **Process count.** `pnpm test` fans out recursively (measured: 9 workspaces at once) and each
 *    workspace starts its own vitest, which fans out again to `availableParallelism() - 1` workers.
 *    Measured over an identical 40s window: 84 concurrent processes holding 7.1 GB uncapped versus
 *    27 holding 1.9 GB capped.
 * 2. **Heap permission per process.** V8 derives its heap limit from system RAM, not from what the
 *    process needs or what the machine has left. On this host that default is **4144 MB per
 *    worker** — and the largest worker the OOM killer reaped measured **3.8 GB**, sitting right at
 *    that ceiling. 84 workers each permitted 4 GB is 340 GB of permission written against 23 GB of
 *    real memory.
 *
 * V8 only collects aggressively as it nears its OWN limit; it cannot see system-wide pressure. So
 * the kernel reaches its limit first. Every worker it kills makes vitest redistribute that worker's
 * files to the survivors, so each survivor runs more files and climbs toward its 4 GB permission
 * faster — which is why each successive worker the killer reaped was larger than the last
 * (1.6 → 3.8 GB). That progression reads like a leak and is not one.
 *
 * ## What the numbers are
 *
 * `maxForks` bounds how many workers run at once; combined with `workspace-concurrency=4` in
 * `.npmrc` it bounds the PRODUCT, which is the quantity that actually overran.
 *
 * `--max-old-space-size` bounds what one worker may hold. 512 MB is roughly 3x the measured
 * per-worker peak in parallel mode (104–181 MB across all 796 files) and above the 384 MB a single
 * worker reaches when it runs every file itself. A worker that would exceed it now collects instead
 * of growing, and if some future test genuinely needs more, it fails loudly in one worker rather
 * than quietly taking the machine down.
 *
 * Both are overridable by environment variable so CI runners with different core counts, and any
 * future test that genuinely needs a larger heap, can raise them deliberately rather than by
 * editing this file.
 */

/**
 * Read a positive-integer override, falling back to the default on anything else.
 *
 * Without this, `VITEST_MAX_FORKS=auto` yields `NaN` and `--max-old-space-size=NaN`, which node
 * accepts and interprets as no limit — the override would silently restore the very default this
 * file exists to remove. A bad value must degrade to the safe number, never to an unbounded one.
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    process.emitWarning(`${name}="${raw}" is not a positive integer — using ${fallback}.`);
    return fallback;
  }
  return parsed;
}

const MAX_FORKS = positiveIntEnv('VITEST_MAX_FORKS', 4);
const WORKER_HEAP_MB = positiveIntEnv('VITEST_WORKER_HEAP_MB', 512);

/**
 * Git's own environment, removed before any test runs.
 *
 * ## Why this is here and not in one test file
 *
 * A git HOOK exports `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and friends into everything it
 * launches. `.husky/pre-push` launches the verification gate, the gate launches vitest, and every
 * `git` a test spawns then inherits them — so a fixture that carefully builds its repository under
 * `mkdtemp` and passes `cwd` still writes to **the repository being pushed from**, because `GIT_DIR`
 * outranks `cwd`.
 *
 * Measured on 2026-08-05 (HARNESS-075). One test file, run twice against a throwaway clone:
 *
 * ```
 * GIT_DIR=… npx vitest run scan-promotion-ancestry.test.mjs   -> branches created in the CLONE
 *           npx vitest run scan-promotion-ancestry.test.mjs   -> clone unchanged
 * ```
 *
 * In the real incident that mechanism moved `develop` onto a fixture commit, set `core.bare`,
 * registered ~20 fixture worktrees, and — because the corrupted `develop` was then what `git push`
 * pushed — rewrote the shared branch on the remote. Three times.
 *
 * ## Why deletion, and why here
 *
 * No test in this repository wants an ambient git context: every one of them either builds its own
 * repository or resolves a path explicitly. So the variables are not "usually unwanted", they are
 * never wanted, and the only reason they were ever present is that something upstream launched us.
 *
 * It lives in the shared ceiling because that is the one file every vitest config in the workspace
 * inherits — the same reason the resource limits are here. A fix in one test file would protect one
 * test file.
 */
const GIT_AMBIENT_ENV: string[] = JSON.parse(
  readFileSync(new URL('./scripts/harness/git-ambient-env.json', import.meta.url), 'utf8'),
).variables;

// DELETED, not set to ''. `GIT_DIR=` (empty) is not the same as absent — git reads the empty value
// and the fixture's own `git init` then fails, which turned a silent corruption into four red tests
// pointing at nothing. Deleting in this process is enough: vitest forks inherit its environment.
for (const name of GIT_AMBIENT_ENV) delete process.env[name];

/**
 * The runner's home directory, replaced with an empty one before any test runs.
 *
 * ## Why this is here and not in one test file
 *
 * Four production entry points default their `userHome` parameter to the real home —
 * `createDefaultUserSettingsSources`, `createDefaultUserContributionSources`,
 * `createContributionSourcesForProjectAccess`, `UpdateCheckCache` — so any test that constructs a
 * session without threading a home reads whatever `~/.claude`, `~/.robota` and `~/.claude/skills`
 * happen to hold on the machine running it. Its result then moves with the machine rather than with
 * the code, in BOTH directions: issue #2300 was filed from a suite that passed locally because the
 * developer had 13 unrelated skills installed and failed on CI, where there are none; issue #2383 is
 * the same mechanism inverted, red locally because of a `SessionStart` hook and green on CI.
 *
 * That is not a property of any one test file, so a fix in one test file would protect one test
 * file. It lives in the shared ceiling for the same reason the ambient-git scrub above does: this is
 * the one file every vitest config in the workspace inherits.
 *
 * ## Why a created directory and not a path that does not exist
 *
 * A missing root and an empty root are different failures. `createNodeHostContributionSource`
 * swallows `ENOENT` and returns no reader at all, so a non-existent home makes every host-owned read
 * a no-op rather than an empty read — the two are indistinguishable from a test's point of view, and
 * only one of them is what a real user with a clean machine has. The directory is therefore created.
 *
 * ## Why the path is also published as an environment variable
 *
 * `packages/agent-framework/src/__tests__/vitest-home-isolation.test.ts` is the floor that keeps
 * this honest, and it has to be able to name the directory it expects. It asserts `os.homedir()`
 * rather than the pool: `homedir()` follows `HOME` in a forked child and not necessarily in a worker
 * thread, so pinning `pool: 'forks'` would make the floor go vacuous on a pool change instead of
 * red.
 *
 * ## Scope, stated where the reader meets it
 *
 * `HOME` is one surface. `os.tmpdir()` contents, a globally installed binary, an authenticated CLI
 * and a populated package store can satisfy an assertion the same way; this closes `HOME` and
 * nothing else. It also cannot see an assertion that passes only because host state is ABSENT —
 * such an assertion passes identically before and after this block.
 */
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), 'robota-vitest-home-'));

// ASSIGNED, not deleted — the opposite of the git block above, and deliberately so. With `HOME`
// absent, `os.homedir()` falls back to the password database and hands back the real home anyway,
// which is precisely the state being removed.
process.env.HOME = ISOLATED_HOME;
process.env.USERPROFILE = ISOLATED_HOME;
process.env.ROBOTA_VITEST_ISOLATED_HOME = ISOLATED_HOME;

// The forks die before this process does, so nothing is still reading the directory here. `force`
// keeps a failed run from adding a second failure on the way out.
process.on('exit', () => {
  rmSync(ISOLATED_HOME, { recursive: true, force: true });
});

export const resourceCeiling = defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: MAX_FORKS,
        execArgv: [`--max-old-space-size=${WORKER_HEAP_MB}`],
      },
    },
  },
});

export default resourceCeiling;
