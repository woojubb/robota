import { describe, expect, it } from 'vitest';

import { parseSkips, runScans } from '../run-all-scans.mjs';

function stubScan(name, exitCode) {
  return {
    name,
    run: () => Promise.resolve(exitCode),
  };
}

describe('run-all-scans', () => {
  it('runs every scan even when an early one fails and exits 1', async () => {
    const ran = [];
    const scans = ['a', 'b', 'c'].map((name, index) => ({
      name,
      run: () => {
        ran.push(name);
        return Promise.resolve(index === 0 ? 1 : 0);
      },
    }));
    const lines = [];
    const exitCode = await runScans(scans, (line) => lines.push(line));
    // Order is non-deterministic under parallelism (INFRA-037); assert every scan RAN, any order.
    expect([...ran].sort()).toEqual(['a', 'b', 'c']);
    expect(exitCode).toBe(1);
    const summary = lines.join('\n');
    expect(summary).toContain('✗ a');
    expect(summary).toContain('✓ b');
    expect(summary).toContain('✓ c');
    expect(summary).toContain('1 of 3 scans failed');
  });

  it('runs scans concurrently under a bounded pool (INFRA-037 TC-01)', async () => {
    let active = 0;
    let maxActive = 0;
    const makeScan = (name) => ({
      name,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return 0;
      },
    });
    const scans = Array.from({ length: 6 }, (_, i) => makeScan(`s${i}`));
    const exitCode = await runScans(scans, () => {}, 3); // concurrency cap = 3
    expect(exitCode).toBe(0);
    expect(maxActive).toBeGreaterThan(1); // proves overlap (sequential would be 1)
    expect(maxActive).toBeLessThanOrEqual(3); // proves the pool is bounded
  });

  it('surfaces a failed scan’s captured output (INFRA-037 TC-02)', async () => {
    const scans = [
      { name: 'ok', run: () => Promise.resolve({ code: 0, output: 'quiet pass\n' }) },
      {
        name: 'boom',
        run: () => Promise.resolve({ code: 1, output: 'ERROR: boundary violation\n' }),
      },
    ];
    const lines = [];
    const exitCode = await runScans(scans, (line) => lines.push(line));
    expect(exitCode).toBe(1);
    const out = lines.join('\n');
    expect(out).toContain('boom (FAILED)');
    expect(out).toContain('ERROR: boundary violation'); // failed output shown
    expect(out).not.toContain('quiet pass'); // passing output suppressed
    expect(out).toContain('1 of 2 scans failed');
  });

  it('exits 0 and reports all-pass when every scan succeeds', async () => {
    const lines = [];
    const exitCode = await runScans([stubScan('x', 0), stubScan('y', 0)], (line) =>
      lines.push(line),
    );
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('all 2 scans passed');
  });

  it('counts multiple failures', async () => {
    const lines = [];
    const exitCode = await runScans(
      [stubScan('x', 1), stubScan('y', 2), stubScan('z', 0)],
      (line) => lines.push(line),
    );
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toContain('2 of 3 scans failed');
  });
});

describe('parseSkips (INFRA-026)', () => {
  it('collects repeatable --skip names', () => {
    expect([...parseSkips(['--skip', 'dist', '--skip', 'deps'])]).toEqual(['dist', 'deps']);
  });

  it('returns empty set without --skip', () => {
    expect(parseSkips([]).size).toBe(0);
  });
});
