import { describe, expect, it } from 'vitest';

import {
  ADVISORY_MARKER,
  SCAN_COMMANDS,
  extractAdvisories,
  extractExamined,
  judgeExamined,
  judgeExaminedAdoption,
  parseSkips,
  runScans,
  writeAdoptionBaseline,
} from '../run-all-scans.mjs';

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
    // "all N scans passed" became "N scans passed": the word `all` covered a suite in which some
    // scans had no subject and were counted anyway (HARNESS-056). The count now states what RAN.
    expect(lines.join('\n')).toContain('2 scans passed');
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
    expect(out).toContain('2 scans passed');
    expect(out).toContain('NOT failures');
  });

  it('leaves the verdict as the LAST line, so a green run still ends green', async () => {
    const scans = [
      { name: 'a', run: () => Promise.resolve({ code: 0, output: `${ADVISORY_MARKER} noted\n` }) },
    ];
    const lines = [];
    await runScans(scans, (line) => lines.push(line));
    expect(lines.filter((line) => line !== '').at(-1)).toBe('1 scans passed');
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

describe('how much did you look at', () => {
  /**
   * The most-repeated defect here is a check reporting success over work it never did, and it
   * arrives in three costumes — a fail-open over an absent tree, a SKIP rendered as a tick, and a
   * shallow walk claiming "all" over a subset. Each was repaired one instance at a time, because
   * nothing asked the question they share.
   */
  it('reads a declared size, and the reason a zero is allowed', () => {
    expect(extractExamined('::examined:: 24 rule documents')).toEqual([
      { size: 24, subject: 'rule documents', expectedEmpty: null },
    ]);
    expect(
      extractExamined('::examined:: 0 plans ::expected-empty:: the pipeline is dormant'),
    ).toEqual([{ size: 0, subject: 'plans', expectedEmpty: 'the pipeline is dormant' }]);
  });

  it('reads a thousands separator, so a big subject is not read as a small one', () => {
    expect(extractExamined('::examined:: 2,747 files')[0].size).toBe(2747);
  });

  it('fails an unearned zero, and only an unearned one', () => {
    expect(judgeExamined('probe', '::examined:: 0 workflows').problems).toHaveLength(1);
    expect(
      judgeExamined('probe', '::examined:: 0 workflows ::expected-empty:: none are configured')
        .problems,
    ).toEqual([]);
    expect(judgeExamined('probe', '::examined:: 13 workflows').problems).toEqual([]);
  });

  it('refuses a size that is not a number', () => {
    // A marker that says nothing measurable is the contentless-advisory shape one channel over: it
    // looks like a declaration and declares nothing.
    expect(judgeExamined('probe', '::examined:: several files').problems).toHaveLength(1);
  });

  it('does not demand a declaration from a scan that makes none', () => {
    // Seventy-nine of ninety-seven declare nothing today. A check that turns the suite red on
    // arrival is suppressed rather than obeyed; adoption is held by the ratchet instead.
    expect(judgeExamined('probe', 'ordinary output').declared).toBe(false);
    expect(judgeExamined('probe', 'ordinary output').problems).toEqual([]);
  });

  it('does not run the ratchet for an arbitrary caller (checkAdoption defaults off)', () => {
    // A caller passing three fixtures wants the unearned-zero half, not the adoption ratchet. The
    // runner's own fixture-based cases below rely on this default staying off.
    const scan = { name: 'probe', run: async () => ({ code: 0, output: 'no declaration here' }) };
    const lines = [];

    return runScans([scan], (l) => lines.push(l), 1).then((code) => {
      expect(code).toBe(0);
      expect(lines.join('\n')).not.toMatch(/adoption/);
    });
  });

  it('fails an unearned zero even on a subset run', () => {
    // A scan claiming a pass over nothing is wrong however few of them ran, so that half carries no
    // exemption for a partial run.
    expect(judgeExamined('probe', '::examined:: 0 workflows').problems).toHaveLength(1);
  });

  it('holds adoption as a SET ratchet: a frozen scan may not stop declaring; a new one must be added', () => {
    const frozen = () => ['a', 'b'];
    const known = ['a', 'b', 'c'];
    // All frozen scans ran and declared; an extra non-frozen, non-declaring scan is fine.
    expect(judgeExaminedAdoption(['a', 'b'], ['a', 'b', 'c'], known, frozen).ok).toBe(true);
    // A frozen scan ran but stopped declaring → FELL, naming it.
    expect(judgeExaminedAdoption(['a'], ['a', 'b'], known, frozen).message).toMatch(/FELL.*\bb\b/);
    // A new scan declares but is not frozen → ROSE, naming it.
    expect(judgeExaminedAdoption(['a', 'b', 'c'], ['a', 'b', 'c'], known, frozen).message).toMatch(
      /ROSE.*\bc\b/,
    );
    // No baseline at all → refuse.
    expect(judgeExaminedAdoption(['a'], ['a'], known, () => null).message).toMatch(/no frozen/);
  });

  it('reports FELL and ROSE together, not one round at a time', () => {
    // A set diff can carry both at once; surfacing only the first would spend a review round per
    // finding. `a` stopped declaring (FELL); `c` newly declares (ROSE).
    const verdict = judgeExaminedAdoption(['b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'], () => [
      'a',
      'b',
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/FELL.*\ba\b/);
    expect(verdict.message).toMatch(/ROSE.*\bc\b/);
  });

  it('flags a frozen scan that is no longer a registered scan at all (GONE — the SET blind spot)', () => {
    // A previously-declaring scan deleted/renamed out of the registry never appears in
    // `evaluableNames` again, so FELL alone would never catch it and the baseline would rot. The
    // GONE check keys off `knownNames`. `ghost` is frozen but absent from the registry.
    const verdict = judgeExaminedAdoption(['a'], ['a'], ['a'], () => ['a', 'ghost']);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/GONE.*ghost/);
  });

  it('skips the GONE check when the registry is not supplied (fixture callers)', () => {
    // knownNames === null → GONE is not judged, so a fixture caller does not fault a name it never
    // claimed to know about.
    expect(judgeExaminedAdoption(['a'], ['a'], null, () => ['a', 'ghost']).ok).toBe(true);
  });

  it('a --skip does not disarm the ratchet, nor falsely fault the skipped scan (HARNESS-081)', () => {
    // The defect: the old count-over-the-whole-registry check only ran with nothing skipped, so
    // CI (which always `--skip`s dist/build-contracts) never evaluated it. A skipped scan is still
    // REGISTERED (in knownNames) but absent from `evaluableNames`, so it is neither judged nor
    // faulted as FELL/GONE — while a NON-skipped scan that stops declaring is still caught. Here
    // `skipped-one` is frozen and registered but did not run; `b` ran and stopped declaring.
    const known = ['a', 'b', 'skipped-one'];
    const verdict = judgeExaminedAdoption(['a'], ['a', 'b'], known, () => [
      'a',
      'b',
      'skipped-one',
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/FELL/);
    expect(verdict.message).toMatch(/\bb\b/);
    expect(verdict.message).not.toMatch(/skipped-one/);
  });

  it('writeAdoptionBaseline merges: keeps unevaluated, adds newly-declaring, prunes deleted', () => {
    let written = null;
    const result = writeAdoptionBaseline(
      ['a', 'c'], // declaring this pass: a (kept), c (new)
      ['a', 'b', 'c'], // evaluable: a, b, c (b was frozen but did not declare → dropped)
      ['a', 'b', 'c'], // known registry (ghost is absent → pruned)
      () => ['a', 'b', 'ghost'], // frozen
      (names) => {
        written = names;
      },
    );
    // a: kept (declared). b: dropped (evaluated, not declaring). c: added (newly declaring).
    // ghost: pruned (not in the registry). Result is sorted.
    expect(result).toEqual(['a', 'c']);
    expect(written).toEqual(['a', 'c']);
  });

  it('writeAdoptionBaseline keeps a frozen entry the pass did NOT evaluate (e.g. --skip)', () => {
    // `skipped-one` is frozen, still registered, and not evaluated this pass → neither confirmed nor
    // refuted, so it is kept rather than dropped.
    const result = writeAdoptionBaseline(
      ['a'],
      ['a'],
      ['a', 'skipped-one'],
      () => ['a', 'skipped-one'],
      () => {},
    );
    expect(result).toEqual(['a', 'skipped-one']);
  });
});

describe('a scan that skipped does not render as a tick', () => {
  /**
   * The runner decided a scan's mark from its exit code alone, so a scan that ran nothing and exited
   * 0 because it had no subject was indistinguishable from one that examined its whole subject and
   * found it clean. Both printed `✓`, and both counted toward "all N scans passed" — a stronger
   * claim than the run supports, on the line people actually read.
   *
   * The declaration supplies the missing signal: a zero WITH a reason is a skip.
   */
  const passed = { name: 'ran', run: async () => ({ code: 0, output: '::examined:: 12 files' }) };
  const skipped = {
    name: 'no-subject',
    run: async () => ({
      code: 0,
      output: '::examined:: 0 transcripts ::expected-empty:: no transcript exists on this host',
    }),
  };

  it('marks it ↩ and counts what RAN', async () => {
    const lines = [];
    const code = await runScans([passed, skipped], (l) => lines.push(l), 1);
    const printed = lines.join('\n');

    expect(code, 'a skip must not fail the suite').toBe(0);
    expect(printed).toContain('↩ no-subject');
    expect(printed).toContain('✓ ran');
    expect(printed, 'the summary counted a skip as a pass').toContain('1 scans passed, 1 skipped');
  });

  it('says nothing about skips when there are none', async () => {
    const lines = [];
    await runScans([passed], (l) => lines.push(l), 1);

    expect(lines.join('\n')).not.toMatch(/skipped/);
  });

  it('does not call an undeclared zero a skip — it fails', async () => {
    // A skip is a scan that said WHY it had no subject. One that merely reports zero has not.
    const lines = [];
    const code = await runScans(
      [{ name: 'silent', run: async () => ({ code: 0, output: '::examined:: 0 files' }) }],
      (l) => lines.push(l),
      1,
    );

    expect(code).toBe(1);
    expect(lines.join('\n')).not.toContain('↩ silent');
  });
});

describe('the registry holds what has been registered', () => {
  /**
   * A registration has no other guard.
   *
   * `regression-red-proof` found this the way it is meant to be found: it reversed a
   * `run-all-scans.mjs` hunk that added a scan, re-ran the changed tests, and every one passed — so
   * nothing in the tree held the registration in place. The wiring had been proven by hand, by
   * breaking a subject and watching the suite go red through it, and a proof that lives only in a
   * transcript is not a check.
   *
   * The rows below are deliberately in THIS file rather than beside each scan: the registry is the
   * subject, this is its paired test, and a reversal of a registration must fail the test of the file
   * that was reversed. An assertion parked in the scan's own test file is not reached by that pairing.
   */
  const names = SCAN_COMMANDS.map((s) => s.name);

  it('registers every scan exactly once — a duplicate runs twice and reports twice', () => {
    expect(names.length).toBe(new Set(names).size);
  });

  it('holds the floors added for INFRA-126 and INFRA-127', () => {
    expect(names).toContain('temp-dir-owner');
    expect(names).toContain('rule-table-shape');
    expect(names).toContain('task-frontmatter-fields');
  });

  it('points each registration at a command, so a name cannot be registered with nothing behind it', () => {
    for (const scan of SCAN_COMMANDS) {
      expect(Array.isArray(scan.command) || typeof scan.run === 'function').toBe(true);
    }
  });
});
