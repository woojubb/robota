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
