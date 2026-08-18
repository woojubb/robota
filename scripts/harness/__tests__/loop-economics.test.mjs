/**
 * HARNESS-114 — the loop economics report.
 *
 * Every fixture is chosen so its assertion is EXACT rather than bounded. The 4-run corpus can only
 * report 50% if the denominator is right; the rounds fixture uses an array whose length differs from
 * every other number in the record, so a figure read from the wrong field cannot accidentally pass.
 * Those two are `measurement-provenance.md` clause 3 and clause 1 applied to this reporter's own
 * output.
 */

import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LEDGER_DIR } from '../loop-run.mjs';
import { collectLoopEconomics, examinedRunCount, renderLoopEconomics } from '../loop-economics.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

function corpus(ledgers) {
  const root = mkdtempSync(path.join(tmpdir(), 'loop-econ-'));
  mkdirSync(path.join(root, LEDGER_DIR), { recursive: true });
  for (const [loop, entries] of Object.entries(ledgers)) {
    writeFileSync(
      path.join(root, LEDGER_DIR, `${loop}.jsonl`),
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );
  }
  return root;
}

const run = (runId, roundFindings, terminal) => ({
  runId,
  opened: '2026-08-18T00:00:00.000Z',
  closed: terminal === null ? null : '2026-08-18T01:00:00.000Z',
  roundFindings,
  terminal,
  ref: null,
});

describe('collectLoopEconomics', () => {
  it('reports NO DATA on an empty corpus — a rate over zero runs is not 0%', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'loop-econ-'));
    expect(collectLoopEconomics(root)).toEqual([]);
    expect(renderLoopEconomics([])[0]).toMatch(/NO DATA/);
    // The property is that no RATE is reported, not that the string "0%" is absent — the NO DATA line
    // says "is not 0%" in prose, and asserting on that substring would fail the message for explaining
    // itself. `rework <n>%` is the shape a reader acts on.
    expect(renderLoopEconomics([]).join(' ')).not.toMatch(/rework \d+%/);
  });

  it('reports exactly 50% for 4 closed runs of which 2 did not converge', () => {
    const root = corpus({
      looper: [
        run('r1', [1], 'converged'),
        run('r2', [1], 'converged'),
        run('r3', [1], 'no-progress'),
        run('r4', [1], 'bound-reached'),
      ],
    });
    const [row] = collectLoopEconomics(root);
    expect(row.closed).toBe(4);
    expect(row.reworked).toBe(2);
    expect(row.reworkRate).toBe(0.5);
    expect(renderLoopEconomics([row])[0]).toContain('rework 50% (2/4)');
  });

  it('takes the rounds figure from roundFindings.length and from nothing else', () => {
    // The array has 3 entries; every other number in the record is deliberately different from 3.
    const root = corpus({ looper: [run('r1', [9, 7, 5], 'converged')] });
    const [row] = collectLoopEconomics(root);
    expect(row.rounds).toEqual([3]);
    expect(renderLoopEconomics([row])[0]).toContain('rounds median 3 max 3');
  });

  it('excludes an OPEN run from the denominator and reports it separately', () => {
    const root = corpus({
      looper: [run('r1', [1], 'converged'), run('r2', [1], 'no-progress'), run('r3', [1], null)],
    });
    const [row] = collectLoopEconomics(root);
    expect(row.closed).toBe(2);
    expect(row.open).toBe(1);
    expect(row.reworkRate).toBe(0.5);
    expect(renderLoopEconomics([row])[0]).toContain('[1 open, excluded]');
  });

  it('reports NO DATA for a loop whose only runs are OPEN', () => {
    const root = corpus({ looper: [run('r1', [1], null)] });
    const [row] = collectLoopEconomics(root);
    expect(row.reworkRate).toBe(null);
    expect(renderLoopEconomics([row])[0]).toMatch(/NO DATA/);
  });

  it('THROWS on a malformed line rather than dropping it from the denominator', () => {
    const root = corpus({ looper: [run('r1', [1], 'converged')] });
    appendFileSync(path.join(root, LEDGER_DIR, 'looper.jsonl'), 'not json\n', 'utf8');
    expect(() => collectLoopEconomics(root)).toThrow(/looper\.jsonl:2/);
  });

  it('computes an even-length median from the two middle values', () => {
    const root = corpus({
      looper: [run('r1', [1], 'converged'), run('r2', [1, 1, 1, 1], 'converged')],
    });
    expect(renderLoopEconomics(collectLoopEconomics(root))[0]).toContain('rounds median 2.5 max 4');
  });
});

describe('the published examined size', () => {
  it('counts every entry READ, open and closed alike', () => {
    const root = corpus({
      a: [run('r1', [1], 'converged'), run('r2', [1], null)],
      b: [run('r3', [1], 'abandoned')],
    });
    collectLoopEconomics(root);
    expect(examinedRunCount()).toBe(3);
  });

  it('starts from zero on a SECOND report, so the size is this run and not the sum of runs', () => {
    const many = corpus({ a: [run('r1', [1], 'converged'), run('r2', [1], 'converged')] });
    collectLoopEconomics(many);
    const one = corpus({ a: [run('r1', [1], 'converged')] });
    collectLoopEconomics(one);
    expect(examinedRunCount()).toBe(1);
  });
});

describe('the metric is published with its ceiling', () => {
  it('states the proxy relationship, what it cannot observe, and that it is advisory', () => {
    const text = readFileSync(path.join(WORKSPACE_ROOT, '.agents/evals/metrics.md'), 'utf8');
    const section = text.slice(
      text.indexOf('Loop Rework Rate'),
      text.indexOf('## Secondary Metrics'),
    );
    // A number published without its ceiling is read as the thing it substitutes for. Each of these is
    // a claim a reader would otherwise have to discover by reading the implementation.
    expect(section).toContain('PROXY');
    expect(section).toContain('cost per accepted change');
    expect(section).toMatch(/관측하지 못하는 것/);
    expect(section).toContain('advisory');
    expect(section).toContain('pnpm harness:loop:report');
  });
});
