/**
 * U5 (issue #1965) — a done record must not leave its own criteria unticked.
 *
 * The rule was filed because four `blocked`/`in-progress` items were marked `done`, dated and moved
 * to `completed/`, and the whole suite passed. So the case that matters most here is the one that
 * reproduces that: unticked boxes under an ordinary heading, in a record claiming completion.
 */

import { describe, expect, it } from 'vitest';

import { evaluateDocument } from '../scan-unearned-done-claims.mjs';
import { findU5, isCriteriaHeading } from '../unmet-criteria.mjs';

const lines = (text) => text.split('\n');

describe('what counts as a criteria heading', () => {
  it.each([
    'Acceptance',
    'Acceptance Criteria',
    'Done gate',
    'Test Plan',
    'Plan',
    '수용 기준',
    '검증 항목',
    'Some heading nobody has written yet',
  ])('judges %s', (heading) => {
    // A DENYLIST: everything is judged unless it is named as exempt. An allowlist would let a
    // heading nobody enumerated escape silently, which is the fail-open direction.
    expect(isCriteriaHeading(heading)).toBe(true);
  });

  it.each(['Children', 'children', 'File Format'])('exempts %s', (heading) => {
    expect(isCriteriaHeading(heading)).toBe(false);
  });
});

describe('finding an unmet criterion', () => {
  it('reports an unticked box and names its section', () => {
    const found = findU5(lines('## Acceptance\n- [ ] the gate is required\n- [x] the scan exists'));
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
    expect(found[0].message).toContain("under 'Acceptance'");
    expect(found[0].message).toContain('the gate is required');
  });

  it('reports nothing when every box is ticked', () => {
    // The other direction. Without it the case above could be passing on a rule that reports every
    // checkbox, ticked or not.
    expect(findU5(lines('## Acceptance\n- [x] done\n- [x] also done'))).toEqual([]);
  });

  it('attributes a box to its INNERMOST heading, not to every heading containing it', () => {
    // The first cut iterated sections, and sections nest — a box under `## Plan` is also inside
    // `# Title`, so every finding was reported twice and every frozen count was double.
    const found = findU5(
      lines('# INFRA-097: provenance\n\n## Plan\n\n- [ ] add adversarial tests'),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("under 'Plan'");
  });

  it('ignores a box inside a fenced block, which is documentation of the syntax', () => {
    expect(findU5(lines('## Acceptance\n\n```md\n- [ ] this is an example\n```\n'))).toEqual([]);
  });

  it('ignores an unticked box under an exempt heading', () => {
    expect(findU5(lines('## Children\n- [ ] CHILD-001 is not this item'))).toEqual([]);
  });
});

describe('the escape is a decision written next to the thing it excuses', () => {
  it('accepts a survivor whose reason is on the box line', () => {
    expect(
      findU5(
        lines('## Acceptance\n- [ ] the live ruleset change — allow-unmet-criterion: owner-only'),
      ),
    ).toEqual([]);
  });

  it('does NOT accept a reason a line away, which could be excusing a different box', () => {
    const found = findU5(
      lines('## Acceptance\n- [ ] first\n- [ ] second — allow-unmet-criterion: owner-only'),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('first');
  });
});

describe('the rule reaches the scan that owns done records', () => {
  it('evaluateDocument reports U5 alongside U1–U4', () => {
    // Wiring, asserted through the composed entry point rather than the rule alone: a rule nobody
    // calls is the defect this issue is about, one layer up.
    const found = evaluateDocument('---\nstatus: done\n---\n\n## Acceptance\n\n- [ ] not met\n');
    expect(found.map((f) => f.rule)).toContain('U5');
  });
});
