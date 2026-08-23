import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findFootprint, readWorkflowFacts } from '../scan-ci-concurrency-footprint.mjs';

/**
 * Concurrent jobs are budgeted per ACCOUNT, so a repository whose own minutes are free still spends a
 * shared resource at full price: every job it dispatches is a slot another repository must wait for.
 * Job count is therefore the number to govern, and it is governed as a ratchet so that adding one is
 * a decision rather than a drift.
 */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workflowRoot(files) {
  const root = makeTemp('ci-footprint-');
  dirs.push(root);
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(root, '.github/workflows', name), body);
  }
  return root;
}

const GUARDED = `on:
  pull_request:
    branches: [develop]

concurrency:
  group: x-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  a:
    runs-on: ubuntu-latest
  b:
    runs-on: ubuntu-latest
`;

describe('scan-ci-concurrency-footprint', () => {
  it('counts the jobs a pull request can dispatch', () => {
    const facts = readWorkflowFacts(GUARDED);
    expect(facts.jobs).toEqual(['a', 'b']);
    expect(facts.triggersPullRequest).toBe(true);
    expect(facts.hasConcurrency && facts.cancelInProgress).toBe(true);
  });

  it('ignores a workflow a pull request cannot trigger — it takes no slot on a push', () => {
    const scheduled =
      'on:\n  schedule:\n    - cron: "0 3 * * *"\n\njobs:\n  nightly:\n    runs-on: ubuntu-latest\n';
    const { jobs } = findFootprint(workflowRoot({ 'a.yml': GUARDED, 'b.yml': scheduled }));
    expect(jobs).toBe(2);
  });

  it('(RED) flags a pull-request workflow with no cancel-in-progress', () => {
    const unguarded =
      'on:\n  pull_request:\n    branches: [develop]\n\njobs:\n  a:\n    runs-on: ubuntu-latest\n';
    const { findings } = findFootprint(workflowRoot({ 'a.yml': unguarded }));
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unguarded-trigger');
  });

  it('(RED) fails closed when there are no workflows to measure', () => {
    const bare = makeTemp('ci-footprint-bare-');
    dirs.push(bare);
    expect(() => findFootprint(bare)).toThrow(/does not exist/);
  });

  it('the live footprint equals the frozen baseline, and the scan is registered', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const { jobs, findings, examined } = findFootprint(root);
    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/ci-footprint-baseline.json'), 'utf8'),
    );
    expect(jobs).toBe(frozen.jobs);
    expect(findings).toEqual([]);
    // A pass over nothing is not a pass: this repository really does dispatch work per pull request.
    expect(jobs).toBeGreaterThan(5);
    expect(examined).toBeGreaterThan(5);
    expect(readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8')).toContain(
      'scan-ci-concurrency-footprint.mjs',
    );
  });
});
