/**
 * CLI-042 — grep-tool bounded-concurrency evidence.
 *
 * Instruments node:fs/promises.readFile with an in-flight counter (plus a small
 * timer delay so overlap is observable) and asserts the directory scan reads
 * files concurrently (maxInFlight >= 2 — fails on the old sequential loop) while
 * staying within the p-limit bound (maxInFlight <= 50).
 */
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const GREP_READ_CONCURRENCY_LIMIT = 50;

const readTracker = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  enabled: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (!readTracker.enabled) return actual.readFile(...args);
      readTracker.inFlight++;
      readTracker.maxInFlight = Math.max(readTracker.maxInFlight, readTracker.inFlight);
      try {
        // Hold the read open across a macrotask so concurrent reads overlap observably.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        return await actual.readFile(...args);
      } finally {
        readTracker.inFlight--;
      }
    },
  };
});

// Import AFTER the mock so grep-tool binds to the instrumented readFile.
const { createGrepTool } = await import('../builtins/grep-tool.js');

interface IGrepResult {
  success: boolean;
  output: string;
  error?: string;
}

// ARCH-010 — the context-free `grepTool` singleton is gone and the root is a required argument, so the
// tool is built against the fixture this suite creates. The root is the scan's boundary, so it has to be
// the fixture: bound anywhere wider, the in-flight counts below would be measuring somebody else's files.
async function runGrep(root: string, args: Record<string, unknown>): Promise<IGrepResult> {
  const tool = createGrepTool({ cwd: root });
  const wrapper = await tool.execute(args as Parameters<typeof tool.execute>[0]);
  const data = (wrapper as { data: unknown }).data;
  return (typeof data === 'string' ? JSON.parse(data) : data) as IGrepResult;
}

describe('grepTool bounded concurrency (CLI-042)', () => {
  const FILE_COUNT = 120;
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = realpathSync(mkdtempSync(join(tmpdir(), 'grep-tool-concurrency-')));
    for (let i = 0; i < FILE_COUNT; i++) {
      writeFileSync(
        join(fixtureDir, `file-${String(i).padStart(3, '0')}.txt`),
        `header ${i}\nneedle ${i}\nfooter ${i}\n`,
      );
    }
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('TC-05: reads files concurrently but never exceeds the p-limit bound', async () => {
    readTracker.inFlight = 0;
    readTracker.maxInFlight = 0;
    readTracker.enabled = true;
    try {
      const result = await runGrep(fixtureDir, {
        pattern: 'needle',
        path: fixtureDir,
        outputMode: 'count',
      });
      expect(result.success).toBe(true);
      expect(result.output.split('\n')).toHaveLength(FILE_COUNT);
    } finally {
      readTracker.enabled = false;
    }

    // Parallelism evidence: the sequential implementation never overlaps reads.
    expect(readTracker.maxInFlight).toBeGreaterThanOrEqual(2);
    // Bound evidence: the limiter caps in-flight reads.
    expect(readTracker.maxInFlight).toBeLessThanOrEqual(GREP_READ_CONCURRENCY_LIMIT);
    expect(readTracker.inFlight).toBe(0);
  });
});
