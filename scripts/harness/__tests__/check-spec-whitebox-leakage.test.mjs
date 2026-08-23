/**
 * RULE-013 — the whitebox-leakage scan's measurement, proven against a fixture of known size.
 *
 * The declared counter (`::examined:: N package SPEC.md files`) is an output, so it is tested as one
 * (`measurement-provenance.md`): an EXACT value against a fixture, not a bound, and asserted again
 * after a second run so an accumulating counter is told apart from a growing subject.
 *
 * The measurement itself is pinned against the two defects the scan shipped with in draft:
 * a depth-1 enumeration that missed the nested `packages/dag-nodes/*` group, and exact heading
 * matching that scored ordinal-prefixed SPECs (`## 1. Scope`) as 100% non-standard. A check that
 * fires on the wrong subject is not a weaker check, it is a different one.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { collectRows, examinedSpecCount, measure } from '../check-spec-whitebox-leakage.mjs';
import { readSpecSectionContract } from '../spec-sections.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const contract = readSpecSectionContract(WORKSPACE_ROOT);

const root = makeTemp('spec-leakage-');
afterAll(() => rmSync(root, { recursive: true, force: true }));

// The finder refuses a root it cannot judge (HARNESS-052), so the fixture root carries the trees it
// requires. Their absence is itself asserted below.
mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
mkdirSync(path.join(root, 'packages'), { recursive: true });

function fixture(name, body) {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, 'docs'), { recursive: true });
  writeFileSync(path.join(dir, 'docs', 'SPEC.md'), body, 'utf8');
  return dir;
}

const CLEAN = ['## Scope', 'a', '## Boundaries', 'b'].join('\n');
const ORDINAL = ['## 1. Scope', 'a', '## 9. Class Contract Registry', 'b'].join('\n');
const LEAKY = ['## Scope', 'a', '## Keyboard Controls', ...Array(40).fill('x')].join('\n');

const dirs = [fixture('clean', CLEAN), fixture('ordinal', ORDINAL), fixture('leaky', LEAKY)];
fixture('no-spec-here', CLEAN);

describe('the declared counter', () => {
  it('reports an exact count over a fixture of known size', () => {
    expect(examinedSpecCount(root, contract, dirs)).toBe(3);
    expect(collectRows(root, contract, dirs)).toHaveLength(3);
  });

  it('reports the same count after a second run of the finder', () => {
    // Run the finder twice, then read the size. An accumulating counter would report 6 here while
    // the subject stayed at 3 — which is the only way to tell accumulation apart from growth.
    collectRows(root, contract, dirs);
    collectRows(root, contract, dirs);
    expect(examinedSpecCount(root, contract, dirs)).toBe(3);
  });

  it('refuses a root with no governed tree rather than reporting a clean corpus', () => {
    const bare = makeTemp('spec-leakage-bare-');
    try {
      expect(() => collectRows(bare, contract, [])).toThrow(/missing from/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('counts only workspaces that actually carry a SPEC.md', () => {
    const withMissing = [...dirs, path.join(root, 'never-created')];
    expect(collectRows(root, contract, withMissing)).toHaveLength(3);
  });
});

describe('the measurement', () => {
  it('counts nothing as leaked when every heading is standard', () => {
    expect(measure(CLEAN, contract).nonStandard).toBe(0);
  });

  it('counts nothing as leaked when standard headings carry ordinal prefixes', () => {
    // The defect: exact matching scored `apps/www` (210 lines, all nine sections, numbered) as
    // 100% non-standard. Asserting its pre-fix value would have frozen a broken measurement.
    expect(measure(ORDINAL, contract).nonStandard).toBe(0);
  });

  it('counts a non-standard section against the file', () => {
    const { total, nonStandard } = measure(LEAKY, contract);
    expect(nonStandard).toBe(41); // the `## Keyboard Controls` heading plus its 40 lines
    expect(total).toBe(43);
  });

  it('treats content before the first heading as standard, not as leakage', () => {
    expect(measure(['# Title', 'intro', '## Scope', 'a'].join('\n'), contract).nonStandard).toBe(0);
  });
});
