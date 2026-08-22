import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findAllRunnerWaits, findRunnerWaits } from '../scan-runner-wait.mjs';

/**
 * A runner is the most expensive place to wait.
 *
 * A job that polls is billed for every second it spends doing nothing, because billing counts the
 * job's wall clock and rounds it up. The cost is invisible in a report: the workflow looks like
 * ordinary work, and the only symptom is that the same run sometimes takes seconds and sometimes
 * many minutes. The wait belongs on the agent side, at an interval, where nothing is billed while
 * nothing is happening.
 */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('scan-runner-wait', () => {
  it('(RED) flags an unbounded poll loop', () => {
    const found = findRunnerWaits(
      ['        run: |', '          while :; do', '            :', '          done'].join('\n'),
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('unbounded-poll-loop');
  });

  it('(RED) flags a sleep long enough to be a wait', () => {
    expect(findRunnerWaits('            sleep 30')[0].kind).toBe('runner-sleep');
    expect(findRunnerWaits('            sleep 20')).toHaveLength(1);
  });

  it('does NOT flag a short settle — that is not a held wait', () => {
    expect(findRunnerWaits('            sleep 2')).toEqual([]);
    expect(findRunnerWaits('            sleep 5')).toEqual([]);
  });

  it('does NOT flag a COUNTED loop, whose iterations are bounded by construction', () => {
    expect(findRunnerWaits('          for i in 1 2 3; do')).toEqual([]);
  });

  it('flags every `until` loop WITHOUT reading its condition — including a bounded one', () => {
    // Stated as it behaves, not as one might wish. A shell `until` in a workflow step is a poll
    // predicate by construction, and deciding from the condition text whether a given one terminates
    // promptly is not reliable. A bounded retry that belongs in a job is written as a counted loop
    // and passes above; one written this way carries the suppression.
    //
    // The first version of this case was titled "does NOT flag a bounded loop" and then asserted
    // that it IS flagged — a test whose title contradicted its own assertion.
    expect(findRunnerWaits('          until [ "$n" -ge 3 ]; do')).toHaveLength(1);
  });

  it('honours a reasoned suppression, on the line or the block above', () => {
    expect(findRunnerWaits('          while :; do # allow-runner-wait: external event')).toEqual(
      [],
    );
    const block = [
      '          # allow-runner-wait: release polls an external event',
      '          sleep 30',
    ].join('\n');
    expect(findRunnerWaits(block)).toEqual([]);
  });

  it('reports how many workflows it examined, so a pass over nothing is not a pass', () => {
    const root = makeTemp('runner-wait-');
    dirs.push(root);
    mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    writeFileSync(
      path.join(root, '.github/workflows/a.yml'),
      'jobs:\n  x:\n    steps:\n      - run: echo hi\n',
    );
    const { findings, examined } = findAllRunnerWaits(root);
    expect(findings).toEqual([]);
    expect(examined).toBe(1);
  });

  it('(RED) fails closed when there are no workflows to read', () => {
    const root = makeTemp('runner-wait-bare-');
    dirs.push(root);
    expect(() => findAllRunnerWaits(root)).toThrow(/does not exist/);
  });

  it('the live tree is clean, and the scan is registered', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const { findings, examined } = findAllRunnerWaits(repoRoot);
    expect(findings).toEqual([]);
    expect(examined).toBeGreaterThan(5);
    const { readFileSync } = await import('node:fs');
    expect(
      readFileSync(path.join(repoRoot, 'scripts/harness/run-all-scans.mjs'), 'utf8'),
    ).toContain('scan-runner-wait.mjs');
  });
});
