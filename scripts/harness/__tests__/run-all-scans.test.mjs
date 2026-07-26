import { describe, expect, it } from 'vitest';

import { ADVISORY_MARKER, extractAdvisories, parseSkips, runScans } from '../run-all-scans.mjs';

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

// ---------------------------------------------------------------------------------------------
// HARNESS-053 — the ADVISORY channel. Rules pinned one at a time.
//
// The gap, MEASURED on the real path before this existed: `touch packages/agent-core/src/index.ts
// && pnpm harness:scan | grep -i stale` printed NOTHING. The `dist` scan had detected the staleness
// and the runner threw the output away, because captured output is surfaced only for a non-zero
// exit. A finding nobody sees is not a finding.
// ---------------------------------------------------------------------------------------------

describe('extractAdvisories', () => {
  it('extracts the text after the marker', () => {
    expect(extractAdvisories(`${ADVISORY_MARKER} dist is stale\n`)).toEqual(['dist is stale']);
  });

  it('ignores unmarked lines, so ordinary passing output stays suppressed', () => {
    const output = `quiet pass\n${ADVISORY_MARKER} the one thing worth saying\nmore chatter\n`;
    expect(extractAdvisories(output)).toEqual(['the one thing worth saying']);
  });

  it('strips the emitting scan’s ANSI colouring', () => {
    // Exactly what scan-dist-freshness prints: yellow open, glyph, marker, text, reset.
    const line = '\x1b[33m\u{1F552} ' + ADVISORY_MARKER + ' coloured advisory\x1b[0m';
    expect(extractAdvisories(line)).toEqual(['coloured advisory']);
  });

  it('does NOT strip bracketed digits that are not an ANSI escape', () => {
    // Pins the ESC in the pattern. Written as `/\[[0-9;]*m/` it matched any `[<digits>m`, so this
    // advisory would have been silently corrupted into "see frame  of the trace".
    expect(extractAdvisories(`${ADVISORY_MARKER} see frame [12m of the trace`)).toEqual([
      'see frame [12m of the trace',
    ]);
  });

  it('drops a marked line with no text after the marker', () => {
    // An advisory channel able to print a contentless bullet is a way to look like it reported
    // something while reporting nothing — the class this whole item exists to close.
    expect(extractAdvisories(`${ADVISORY_MARKER}\n${ADVISORY_MARKER}   \n`)).toEqual([]);
  });

  it('returns nothing for empty or absent output', () => {
    expect(extractAdvisories('')).toEqual([]);
    expect(extractAdvisories(undefined)).toEqual([]);
  });

  it('preserves order and collects several', () => {
    expect(extractAdvisories(`${ADVISORY_MARKER} first\n${ADVISORY_MARKER} second\n`)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('runScans — advisory surfacing', () => {
  it('surfaces an advisory from a PASSING scan while still suppressing its other output', async () => {
    const scans = [
      {
        name: 'dist',
        run: () =>
          Promise.resolve({
            code: 0,
            output: `quiet pass\n${ADVISORY_MARKER} @pkg/a: dist/ may be STALE\n`,
          }),
      },
    ];
    const lines = [];
    const exitCode = await runScans(scans, (line) => lines.push(line));
    const out = lines.join('\n');

    expect(exitCode).toBe(0);
    expect(out).toContain('⚑ dist: @pkg/a: dist/ may be STALE');
    expect(out).not.toContain('quiet pass'); // the pre-existing suppression is unchanged
  });

  it('does NOT turn the suite red — an advisory-only run still exits 0 and reports all-pass', async () => {
    const scans = [
      { name: 'a', run: () => Promise.resolve({ code: 0, output: `${ADVISORY_MARKER} noted\n` }) },
      { name: 'b', run: () => Promise.resolve(0) },
    ];
    const lines = [];
    const exitCode = await runScans(scans, (line) => lines.push(line));
    const out = lines.join('\n');

    expect(exitCode).toBe(0);
    expect(out).toContain('✓ a'); // the emitting scan is still a PASS in the summary
    expect(out).toContain('all 2 scans passed');
    expect(out).toContain('NOT failures');
  });

  it('leaves the verdict as the LAST line, so a green run still ends green', async () => {
    const scans = [
      { name: 'a', run: () => Promise.resolve({ code: 0, output: `${ADVISORY_MARKER} noted\n` }) },
    ];
    const lines = [];
    await runScans(scans, (line) => lines.push(line));
    expect(lines.filter((line) => line !== '').at(-1)).toBe('all 1 scans passed');
  });

  it('prints no advisory block at all when there are none', async () => {
    const lines = [];
    await runScans([stubScan('a', 0), stubScan('b', 0)], (line) => lines.push(line));
    const out = lines.join('\n');
    expect(out).not.toContain('⚑');
    expect(out).not.toContain('advisory');
  });

  it('is general, not a dist special case — a FAILING scan’s advisory is surfaced too', async () => {
    const scans = [
      {
        name: 'other',
        run: () =>
          Promise.resolve({
            code: 1,
            output: `ERROR: boom\n${ADVISORY_MARKER} also worth noting\n`,
          }),
      },
    ];
    const lines = [];
    const exitCode = await runScans(scans, (line) => lines.push(line));
    const out = lines.join('\n');

    expect(exitCode).toBe(1);
    expect(out).toContain('ERROR: boom');
    expect(out).toContain('⚑ other: also worth noting');
    expect(out).toContain('1 of 1 scans failed');
  });

  it('attributes each advisory to the scan that emitted it', async () => {
    const scans = [
      { name: 'a', run: () => Promise.resolve({ code: 0, output: `${ADVISORY_MARKER} from-a\n` }) },
      { name: 'b', run: () => Promise.resolve({ code: 0, output: `${ADVISORY_MARKER} from-b\n` }) },
    ];
    const lines = [];
    await runScans(scans, (line) => lines.push(line));
    const out = lines.join('\n');
    expect(out).toContain('⚑ a: from-a');
    expect(out).toContain('⚑ b: from-b');
    expect(out).toContain('2 advisory finding(s)');
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
