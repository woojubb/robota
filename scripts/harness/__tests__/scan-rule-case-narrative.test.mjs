import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { compare, findCaseNarrative, scanRules } from '../scan-rule-case-narrative.mjs';

/**
 * A rule states an invariant; the incident that taught it belongs in the record that owns it.
 *
 * The cost of getting this wrong is not tidiness. Every line of a rule is loaded before any work
 * begins, and a rule justified by an incident invites the reader to decide whether their situation
 * resembles that incident — which is the discretion a rule exists to remove.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const RULES_DIR = path.resolve(import.meta.dirname, '../../../.agents/rules');

/** Nothing resolves, so a link is judged on the link alone and not on the tree under it. */
const nothingResolves = { resolves: () => false };
const everythingResolves = { resolves: () => true };

describe('what counts as a case', () => {
  it('flags the three citation shapes', () => {
    const found = findCaseNarrative(
      [
        'Never force-push a shared branch (SOME-123).',
        'Owner feedback, 2026-07-17: commit as the work progresses.',
        'A blind delete once removed the integration branch (#1483).',
      ].join('\n'),
      nothingResolves,
    );

    expect(found.map((f) => f.citation)).toEqual(['SOME-123', '2026-07-17', '#1483']);
    expect(found.every((f) => f.kind === 'case-narrative')).toBe(true);
  });

  it('does not flag an invariant stated without one', () => {
    // The reference form. Two documents in the tree already meet it, which is why it is a target and
    // not an aspiration — see the case over the real tree below.
    const found = findCaseNarrative(
      'A gate that cannot be run locally is a gate discovered in CI. Run it before you reach it.',
      nothingResolves,
    );

    expect(found).toEqual([]);
  });

  it('exempts a citation that links to a record which exists', () => {
    // This is the relocation the form asks for: the invariant is here, the incident is over there,
    // and the reader can go and read it.
    const line = 'Contained — [SOME-123](../tasks/SOME-123-the-thing.md).';

    expect(findCaseNarrative(line, everythingResolves)).toEqual([]);
  });

  it('flags a citation whose link resolves to nothing, and says which defect it is', () => {
    // The worse of the two. Naming a record that is not there is the condition the rules themselves
    // refuse, and calling it `case-narrative` would send the fix the wrong way — the repair is to
    // point the link somewhere real, not to delete it.
    const found = findCaseNarrative('See [SOME-123](../tasks/SOME-123-gone.md).', nothingResolves);

    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('unresolved-link');
  });

  it('counts two different records named by one broken link, not just the first', () => {
    // Deduping on the link alone swallowed the second: the first identifier claimed the link and
    // every later citation inside it was dropped, so a line naming two dead records reported one. The
    // key is the record, not the link — which still collapses the identifier that a link repeats in
    // its text and its path by construction.
    const twoRecords = findCaseNarrative('[SOME-100 and SOME-200](../gone.md)', nothingResolves);
    const oneRecordTwice = findCaseNarrative('[SOME-100](../SOME-100-x.md)', nothingResolves);

    expect(twoRecords.map((f) => f.citation)).toEqual(['SOME-100', 'SOME-200']);
    expect(oneRecordTwice).toHaveLength(1);
  });

  it('treats an identifier inside a fenced block as a specimen', () => {
    // A format being shown needs a slot filled in, and the filling is not a claim that it happened.
    const found = findCaseNarrative(
      ['File the item as:', '```', 'SOME-123-a-short-slug.md   # 2026-07-17', '```'].join('\n'),
      nothingResolves,
    );

    expect(found).toEqual([]);
  });

  it('closes the fence again, so a citation after the block is still seen', () => {
    // A one-way fence flag would silence the whole rest of the document after any code block —
    // the largest rule files open several, and everything below the first would stop being read.
    const found = findCaseNarrative(
      ['```', 'SOME-111-inside.md', '```', 'And afterwards, SOME-222 outside.'].join('\n'),
      nothingResolves,
    );

    expect(found.map((f) => f.citation)).toEqual(['SOME-222']);
  });

  it('still sees a citation wrapped in an inline code span', () => {
    // Review proposed exempting inline spans by the same argument that exempts fenced blocks. It does
    // not hold here, on two counts measured over the real tree: of the citations inside single
    // backticks, some are format specimens and at least one is a plain retelling of a particular
    // case, so the exemption would not separate them — and it would make evasion two backticks wide.
    // An inline example that must name a real identifier declares itself instead, which is one line.
    const found = findCaseNarrative('Shipped in all three phases: `SOME-123`.', nothingResolves);

    expect(found.map((f) => f.citation)).toEqual(['SOME-123']);
  });

  it('honours a declared exception that carries its reason, and not one that does not', () => {
    const withReason =
      'The identifier is the format. <!-- allow-citation: names the wire field -->';
    const bare = 'Keeping this one because. <!-- allow-citation: -->';

    expect(findCaseNarrative(`SOME-123 ${withReason}`, nothingResolves)).toEqual([]);
    expect(findCaseNarrative(`SOME-123 ${bare}`, nothingResolves)).toHaveLength(1);
  });
});

describe('the ratchet', () => {
  it('reports a rise, a fall, an unfrozen document and a stale row — all in one pass', () => {
    // One run must tell an operator everything they have to act on. Stopping at the first offender
    // turns a sweep into a queue of runs, and the second finding is the one that gets lost.
    const verdict = compare(
      { 'grew.md': 4, 'fell.md': 1, 'new.md': 2, 'clean.md': 0 },
      { 'grew.md': 2, 'fell.md': 3, 'deleted.md': 5 },
    );

    expect(verdict.grew).toEqual([{ name: 'grew.md', count: 4, frozen: 2 }]);
    expect(verdict.shrunk).toEqual([{ name: 'fell.md', count: 1, frozen: 3 }]);
    expect(verdict.unfrozen).toEqual([{ name: 'new.md', count: 2 }]);
    expect(verdict.missing).toEqual(['deleted.md']);
    expect(verdict.ok).toBe(false);
  });

  it('passes only when every document sits exactly on its frozen count', () => {
    expect(compare({ 'a.md': 3, 'b.md': 0 }, { 'a.md': 3 }).ok).toBe(true);
  });

  it('does not treat a new document with no citations as unfrozen', () => {
    // A rule written in the target form must not have to be added to the baseline to be allowed.
    expect(compare({ 'clean.md': 0 }, {}).ok).toBe(true);
  });
});

describe('over the tree it governs', () => {
  it('refuses a root with no rules to read instead of reporting a low count', () => {
    // Fail closed. A count taken over no documents is not a low count — the failure mode this
    // harness has met most often is a check that examined nothing and rendered as a tick.
    const dir = makeTemp('rules-empty-');
    scratch.push(dir);

    expect(() => scanRules(dir)).toThrow(/does not exist/);

    mkdirSync(path.join(dir, '.agents/rules'), { recursive: true });
    expect(() => scanRules(dir), 'an empty rules directory passed as clean').toThrow(
      /no documents to examine/,
    );
  });

  it('reports the tree at zero, over a tree it actually read', () => {
    // This case was written asserting the opposite — the check was trusted because it FAILED against
    // a tree carrying 128 citations — and it said that when the count reached zero the assertion
    // should become "is zero" rather than be deleted. It has, so it is.
    //
    // The count alone would pass over a tree the scan never opened, so the document count is asserted
    // beside it. The detector's ability to see a citation is proved by the cases above, against
    // sources that carry one; this case is about the tree.
    const { findings, examined } = scanRules();

    expect(examined, 'the scan examined almost no rule documents').toBeGreaterThan(10);
    expect(findings, 'a citation is back in the rules tree').toEqual([]);
  });

  it('reports zero for the documents already written in the target form', () => {
    // `tdd-and-planning.md` states the longest technical invariant in the tree with no case material
    // at all. The form is achievable; these two are the reference.
    for (const name of ['tdd-and-planning.md', 'naming-style.md']) {
      const source = readFileSync(path.join(RULES_DIR, name), 'utf8');
      expect(
        findCaseNarrative(source, { resolves: () => false }),
        `${name} is the reference form and no longer meets it`,
      ).toEqual([]);
    }
  });

  it('is registered, so it runs', () => {
    // A scan nobody dispatches is indistinguishable from no scan — measured repeatedly in this tree.
    const registry = readFileSync(
      path.resolve(import.meta.dirname, '../run-all-scans.mjs'),
      'utf8',
    );

    expect(registry).toContain('scan-rule-case-narrative.mjs');
  });

  it('freezes what it measures, and the frozen file matches the tree', () => {
    // A baseline that has drifted from the tree is the ratchet reporting on a state that no longer
    // exists. This is the case that makes a forgotten re-freeze loud.
    const baseline = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, '../rule-case-narrative-baseline.json'),
        'utf8',
      ),
    );
    const { perFile } = scanRules();

    expect(compare(perFile, baseline).ok, 'the baseline no longer describes the tree').toBe(true);
  });
});
