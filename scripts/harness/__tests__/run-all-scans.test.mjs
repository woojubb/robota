import { describe, expect, it } from 'vitest';

import { runScans } from '../run-all-scans.mjs';

function stubScan(name, exitCode) {
  return {
    name,
    run: () => Promise.resolve(exitCode),
  };
}

describe('run-all-scans', () => {
  it('runs every scan even when an early one fails and exits 1', async () => {
    const order = [];
    const scans = ['a', 'b', 'c'].map((name, index) => ({
      name,
      run: () => {
        order.push(name);
        return Promise.resolve(index === 0 ? 1 : 0);
      },
    }));
    const lines = [];
    const exitCode = await runScans(scans, (line) => lines.push(line));
    expect(order).toEqual(['a', 'b', 'c']);
    expect(exitCode).toBe(1);
    const summary = lines.join('\n');
    expect(summary).toContain('✗ a');
    expect(summary).toContain('✓ b');
    expect(summary).toContain('✓ c');
    expect(summary).toContain('1 of 3 scans failed');
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
