import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  judgeEntries,
  knownMechanisms,
  readEntries,
  scanMistakeMechanisms,
} from '../scan-mistake-mechanisms.mjs';

/**
 * Writing a mistake down demonstrably does not stop it. The clearest instance here: an anti-rot
 * firing over a subject it did not govern was fixed in one scan, the lesson recorded — and the
 * identical defect was written into a NEW scan hours later, by the same author.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const KNOWN = {
  scan: new Set(['real-scan']),
  lint: new Set(['no-console']),
  ci: new Set(['build']),
};
const entry = (over) => ({ number: 1, named: null, acceptedReason: null, answered: true, ...over });
const kinds = (e) => judgeEntries([e], KNOWN).map((f) => f.kind);

describe('every entry answers, one way or the other', () => {
  it('fails an entry that names nothing and admits nothing', () => {
    // "No mechanism" must be a decision, not the state that happens when nobody wrote one.
    expect(kinds(entry({ answered: false }))).toEqual(['no-answer']);
  });

  it('fails an admission with no reason, and passes one with', () => {
    // The reason IS the decision. Without it the field is a box that gets filled with silence.
    expect(kinds(entry({}))).toEqual(['accepted-without-a-reason']);
    expect(
      kinds(entry({ acceptedReason: 'judgement — no test separates it from correct work' })),
    ).toEqual([]);
  });
});

describe('a named mechanism must exist', () => {
  it('fails a scan, lint rule or CI job that is not there', () => {
    // A field satisfied by a MENTION is the exact defect this catalogue is about.
    expect(kinds(entry({ named: 'ghost-scan' }))).toEqual([
      'names-a-mechanism-that-does-not-exist',
    ]);
    expect(kinds(entry({ named: 'lint:never-configured' }))).toEqual([
      'names-a-mechanism-that-does-not-exist',
    ]);
    expect(kinds(entry({ named: 'ci:no-such-job' }))).toEqual([
      'names-a-mechanism-that-does-not-exist',
    ]);
  });

  it('passes each namespace when the thing is real', () => {
    expect(kinds(entry({ named: 'real-scan' }))).toEqual([]);
    expect(kinds(entry({ named: 'lint:no-console' }))).toEqual([]);
    expect(kinds(entry({ named: 'ci:build' }))).toEqual([]);
  });

  it('reads a lint rule however the configuration quotes it', () => {
    // The configuration here is JSON, where a rule name is double-quoted. Matching single quotes
    // only reported two real, configured rules as not existing — the check firing on correct data,
    // caught by running it.
    const root = makeTemp('mech-');
    scratch.push(root);
    writeFileSync(
      path.join(root, '.eslintrc.json'),
      '{ "rules": { "@typescript-eslint/no-explicit-any": "error", "no-console": "error" } }',
    );

    const known = knownMechanisms(root);
    expect(known.lint.has('@typescript-eslint/no-explicit-any')).toBe(true);
    expect(known.lint.has('no-console')).toBe(true);
  });
});

describe('over the catalogue it governs', () => {
  it('refuses a root with no catalogue, and one with no entries', () => {
    // Fail closed: a catalogue that is not there has no unanswered entries, and that is not a pass.
    const dir = makeTemp('mech-empty-');
    scratch.push(dir);
    expect(() => scanMistakeMechanisms(dir)).toThrow(/does not exist/);

    mkdirSync(path.join(dir, '.agents/rules'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/rules/common-mistakes.md'), '# Common Mistakes\n');
    expect(() => scanMistakeMechanisms(dir)).toThrow(/no entries/);
  });

  it('reads the shipped catalogue and finds every entry answered', () => {
    const { entries, accepted, findings } = scanMistakeMechanisms();

    expect(entries, 'the catalogue shrank unexpectedly').toBeGreaterThan(50);
    expect(findings).toEqual([]);
    // The admission count is the debt this item exists to make visible. Asserted as a range rather
    // than a number so lowering it — which is the point — does not break the case.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(entries);
  });

  it('parses an entry row into its claim', () => {
    expect(readEntries('| 7 | m | fix. **Mechanism:** `real-scan`. |')[0]).toMatchObject({
      number: 7,
      named: 'real-scan',
    });
    expect(readEntries('| 8 | m | fix. **Mechanism:** none — judgement. |')[0]).toMatchObject({
      number: 8,
      named: null,
      acceptedReason: 'judgement',
    });
  });

  it('is registered, so it runs', () => {
    const registry = readFileSync(
      path.resolve(import.meta.dirname, '../run-all-scans.mjs'),
      'utf8',
    );

    expect(registry).toContain('scan-mistake-mechanisms.mjs');
  });
});
