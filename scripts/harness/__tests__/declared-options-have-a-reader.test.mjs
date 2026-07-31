import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DISPOSITIONS } from '../record-local-review.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * A rule that offers a choice must have somewhere for the choice to be RECORDED, and every option it
 * names must be one that place accepts.
 *
 * Measured 2026-08-01. `finding-depth.md` offered two dispositions for a FOUNDATIONAL verdict and
 * said "never a third option". One of them did something: `containment` left a code comment and a
 * commit body carrying the root item's ID. The other, `re-plan` — the change is WITHDRAWN — was a
 * word in a note that nothing read, so a change recorded as withdrawn merged like any other.
 *
 * That is a decision with no actor, and it had been sitting inside the rule written against exactly
 * that shape. It was found by a person reading the rule, not by anything mechanical: the recorder had
 * no disposition field at all, so there was nothing to disagree with.
 *
 * This is the disagreement. The rule's option list and the recorder's accepted set are read from
 * their two sources and required to be the same set — so an option added to the prose with nowhere
 * to record it fails, and so does a value the recorder accepts that the rule never sanctioned.
 *
 * What it does NOT claim: that each option then has a consequence. `re-plan` earns its keep because
 * `merge-gate` refuses the merge, and that is held by its own case in `merge-gate-decision`. This
 * check holds the earlier step — that the choice can be written down at all.
 */
const RULE = path.join(WORKSPACE_ROOT, '.agents/rules/finding-depth.md');

/**
 * The dispositions the rule names, read from the section that defines them.
 *
 * Scoped to that section on purpose: the same `- **name** —` shape carries the four VERDICTS earlier
 * in the file, and a whole-file scan would conflate two vocabularies — which is the kind of quiet
 * over-match that makes a floor fire on correct work.
 */
export function declaredDispositions(ruleText) {
  const start = ruleText.indexOf('**The disposition decides');
  if (start === -1) return [];
  const rest = ruleText.slice(start);
  const end = rest.indexOf('\n**');
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^- \*\*([a-z-]+)\*\*/gm)].map((m) => m[1]).sort();
}

describe('an option the rule offers has somewhere to be recorded', () => {
  const ruleText = readFileSync(RULE, 'utf8');

  it('finds the section it reads', () => {
    // Fail closed: a renamed heading would make the comparison below pass over an empty list, which
    // is the vacuity this whole file is about.
    expect(declaredDispositions(ruleText).length).toBeGreaterThan(1);
  });

  it('the rule and the recorder name the same set', () => {
    expect(
      declaredDispositions(ruleText),
      'the rule offers a disposition the recorder will not accept, or the recorder accepts one the ' +
        'rule never sanctioned. An option with nowhere to be written down is a decision made in ' +
        'prose and absent from anything that acts on it.',
    ).toEqual([...DISPOSITIONS].sort());
  });

  it('reads the option list, and not the verdict list above it', () => {
    // The distinction this rests on, pinned. `- **LOCAL** —` and friends use the identical shape a
    // few paragraphs earlier; a whole-file match would return six names and compare two vocabularies
    // as one.
    expect(declaredDispositions(ruleText)).not.toContain('local');
    expect(declaredDispositions(ruleText)).not.toContain('foundational');
    expect(
      declaredDispositions('nothing here'),
      'a missing section returned options it could not have read',
    ).toEqual([]);
  });
});
