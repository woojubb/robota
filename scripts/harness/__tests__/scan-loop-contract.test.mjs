import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  judgeRule,
  passages,
  judgeSkill,
  parseDeclaration,
  readMapBounds,
  scanLoops,
} from '../scan-loop-contract.mjs';

/**
 * A loop that cannot notice it is stuck, and a registry that disagrees with the loop it registers.
 *
 * The bound that can see a loop stuck depends on what a round PRODUCES: a counter cannot tell a
 * stuck round from a productive one, and a finding set can. That fact was written twice — in the
 * skill and in the orchestration map — so the two could disagree, and did.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const LOOPING_BODY = 'On a FAIL, **repeat phase 1**.';

function skill(frontmatter, body = LOOPING_BODY) {
  return `---\nname: probe\n${frontmatter}\n---\n\n${body}\n`;
}

describe('what a round produces decides the bound', () => {
  it('demands a declaration from a body that describes a loop', () => {
    // The population is established by the machine. A hand-kept list of which skills loop was
    // corrected in five consecutive review rounds before this scan existed; a list nobody can
    // recount is wrong the moment a skill is added.
    const found = judgeSkill({ name: 'probe', text: skill('description: x') });

    expect(found.map((f) => f.kind)).toEqual(['undeclared-loop']);
  });

  it('asks nothing of a skill that describes no loop', () => {
    // A check that fired on every skill would be a check firing on a correct state.
    expect(
      judgeSkill({ name: 'probe', text: skill('description: x', 'It does one thing, once.') }),
    ).toEqual([]);
  });

  it('refuses a finding-set loop bounded only by a count', () => {
    const found = judgeSkill({
      name: 'probe',
      text: skill('loop: over=finding-set; bound=2 rounds'),
    });

    expect(found.map((f) => f.kind)).toEqual(['no-escape-declared']);
  });

  it('refuses an escape that is declared and never stated', () => {
    // The dodge this repository already has a floor about: a frontmatter key is cheap, and a
    // declaration nothing implements is not an escape.
    const found = judgeSkill({
      name: 'probe',
      text: skill('loop: over=finding-set; escape=no-progress', 'On a FAIL, **repeat phase 1**.'),
    });

    expect(found.map((f) => f.kind)).toEqual(['escape-declared-not-stated']);
  });

  it('accepts a finding-set loop whose body says what a stuck round does', () => {
    const found = judgeSkill({
      name: 'probe',
      text: skill(
        'loop: over=finding-set; escape=no-progress',
        'On a FAIL, **repeat phase 1**; if the same findings recur unchanged, stop and escalate.',
      ),
    });

    expect(found).toEqual([]);
  });

  it('requires a NUMBER from an attempt loop, and no escape', () => {
    // An attempt loop retries one action that either succeeds or does not. There is no set for a
    // no-progress rule to compare, so a count is the only bound available — and "bounded" with no
    // number is not one. Demanding an escape here would be the check firing on a correct state.
    expect(
      judgeSkill({ name: 'probe', text: skill('loop: over=attempt; bound=3 requests') }),
    ).toEqual([]);

    const vague = judgeSkill({ name: 'probe', text: skill('loop: over=attempt; bound=bounded') });
    expect(vague.map((f) => f.kind)).toEqual(['attempt-loop-without-a-number']);
  });

  it('lets a skill defer to a loop it does not drive, but not to nothing', () => {
    // The sweep is deliberately broad and therefore catches references as well as loops. The answer
    // is an explicit deferral, not a narrower sweep that starts missing real loops again — and the
    // owner must resolve, or "someone else bounds this" is a claim about nothing.
    const ok = judgeSkill({
      name: 'probe',
      text: skill('loop: over=delegated; owner=real-loop'),
      ownerExists: (owner) => owner === 'real-loop',
    });
    expect(ok).toEqual([]);

    const dangling = judgeSkill({
      name: 'probe',
      text: skill('loop: over=delegated; owner=ghost'),
      ownerExists: () => false,
    });
    expect(dangling.map((f) => f.kind)).toEqual(['delegated-to-nothing']);
  });
});

describe('the map and the skill state one bound', () => {
  it('reads the Loop-back cell against the orchestrator each row names', () => {
    const table = [
      '| Pipeline | Orchestrator | Workers | Guardians | Loop-back | Floor |',
      '| --- | --- | --- | --- | --- | --- |',
      '| **Some pipeline** | `alpha` → `beta` | `w` | `g` | auto → escape: no-progress | `scan-x` |',
    ].join('\n');

    const bounds = readMapBounds(table);
    // A row is owned by the first skill it names; the rest are collaborators it hands to.
    expect(bounds.get('alpha')).toBe('auto → escape: no-progress');
    expect(bounds.get('beta')).toBe('auto → escape: no-progress');
  });

  it('gives a shared sub-orchestration its OWN row, not the row that hands to it', () => {
    // Measured on the real map: a shared skill was mentioned in an earlier row's orchestrator cell
    // and judged against THAT row's bound instead of its own. A substring comparison hid the
    // mismatch because the borrowed cell carried a date whose digits matched the declared number.
    const table = [
      '| Pipeline | Orchestrator | Workers | Guardians | Loop-back | Floor |',
      '| --- | --- | --- | --- | --- | --- |',
      '| **Caller** | `caller` (hands off to `shared`) | `w` | `g` | auto → no cap (2026-08-03) | `s` |',
      '| **Shared** | `shared` (called by `caller`) | `w` | `g` | auto → bounded (2 attempts) | `s` |',
    ].join('\n');

    const bounds = readMapBounds(table);
    expect(bounds.get('shared'), "the shared skill borrowed its caller's bound").toBe(
      'auto → bounded (2 attempts)',
    );
    expect(bounds.get('caller')).toBe('auto → no cap (2026-08-03)');
  });

  it('fails when the map understates an escape the skill declares', () => {
    // The live instance HARNESS-072 recorded and deliberately left standing: the map called a
    // pipeline count-only bounded while its own skill carried the escape.
    const found = judgeSkill({
      name: 'probe',
      text: skill(
        'loop: over=finding-set; escape=no-progress',
        'Repeat until clean; if the same findings recur unchanged, stop.',
      ),
      mapBound: 'auto → bounded (2 review rounds); halt at every cap',
    });

    expect(found.map((f) => f.kind)).toEqual(['map-understates-the-escape']);
  });

  it('does not accept a map number that merely CONTAINS the declared one', () => {
    // `'12'.includes('1')` is true, so a substring comparison let a skill declaring 1 round agree
    // with a map cell saying 12 — a silent disagreement, which is the one thing this check exists to
    // make impossible.
    const found = judgeSkill({
      name: 'probe',
      text: skill(
        'loop: over=finding-set; escape=no-progress; bound=1 round',
        'Repeat until clean; if the same findings recur unchanged, stop.',
      ),
      mapBound: 'auto → escape: no-progress, plus 12 rounds',
    });

    expect(found.map((f) => f.kind)).toEqual(['map-disagrees-on-the-bound']);
  });

  it('fails when the map carries a different number from the skill', () => {
    const found = judgeSkill({
      name: 'probe',
      text: skill(
        'loop: over=finding-set; escape=no-progress; bound=2 rounds',
        'Repeat until clean; if the same findings recur unchanged, stop.',
      ),
      mapBound: 'auto → escape: no-progress, plus 3 rounds',
    });

    expect(found.map((f) => f.kind)).toEqual(['map-disagrees-on-the-bound']);
  });

  it("does not read a DATE's digits as the map's bound", () => {
    // `readMapBounds`' own history is a date standing in for a bound; a bare first-digits
    // extraction re-imports that class one clause over. The real map's PR-review cell carries
    // `owner directive 2026-08-03`, so the first number in the cell is 2026 — which is not a
    // bound, and must not turn a numberless cell into a disagreement with any declared count.
    const found = judgeSkill({
      name: 'probe',
      text: skill(
        'loop: over=attempt; bound=3 requests',
        'Ask again, bounded at 3 requests; then halt for the user.',
      ),
      mapBound: 'auto → no cap (owner directive 2026-08-03); halts for the user',
    });

    expect(found, 'a date was read as the bound').toEqual([]);
  });

  it('still flags a real quantified disagreement standing next to a date', () => {
    const found = judgeSkill({
      name: 'probe',
      text: skill(
        'loop: over=attempt; bound=3 requests',
        'Ask again, bounded at 3 requests; then halt for the user.',
      ),
      mapBound: 'auto → bounded, 2 requests (owner directive 2026-08-03)',
    });

    expect(found.map((f) => f.kind)).toEqual(['map-disagrees-on-the-bound']);
    expect(found[0].detail).toContain('says 2');
  });
});

describe('a rule that states a loop is bound by the same contract', () => {
  // This is where a rule-versus-rule contradiction actually arrived: one mandatory rule said
  // "bounded iterations, then escalate" — a count as the only bound — while another forbade exactly
  // that, in normative text, created by the change that landed the second. Rules outrank skills, so
  // a reader following the first was correct to ignore the second.

  it('flags a rule whose loop paragraph names no escape', () => {
    const found = judgeRule({
      name: 'research.md',
      text: '- **Loop-back is hybrid.** The orchestrator AUTO-re-drives toward convergence:\n  bounded iterations, then escalate to the user.\n',
    });

    expect(found.map((f) => f.kind)).toEqual(['rule-states-a-loop-without-its-escape']);
  });

  it('does not accept a link that sits in some OTHER paragraph', () => {
    // The first version asked whether the FILE anywhere linked the rule that owns the escape. Every
    // rule links that rule for other reasons, so restoring the exact wording this check exists to
    // catch left it green — an exemption granted by coincidence. Judged per paragraph now.
    const found = judgeRule({
      name: 'research.md',
      text: [
        'See [enforcement-architecture.md](enforcement-architecture.md) for the worker model.',
        '- **Loop-back is hybrid.** The orchestrator AUTO-re-drives: bounded iterations, then escalate.',
      ].join('\n\n'),
    });

    expect(found.map((f) => f.kind)).toEqual(['rule-states-a-loop-without-its-escape']);
  });

  it("does not let a SIBLING BULLET's link excuse a loop bullet", () => {
    // A bulleted list is one blank-line block, so splitting on blank lines left the coincidence
    // intact one level tighter: an unrelated bullet's link to the rule that owns the escape would
    // excuse a loop bullet that carried none. Each list item is its own passage, and each normative
    // bullet has to stand on its own — which is what this rule set asks of an entry anyway.
    const found = judgeRule({
      name: 'spec-workflow.md',
      text: [
        '- See [enforcement-architecture.md](enforcement-architecture.md) for the worker model.',
        '- Any contract change MUST be followed by a conformance verification loop.',
      ].join('\n'),
    });

    expect(found.map((f) => f.kind)).toEqual(['rule-states-a-loop-without-its-escape']);
  });

  it('splits a list into its items, and keeps their continuation lines', () => {
    expect(passages('- one\n  wrapped\n- two\n\nprose')).toEqual([
      '- one\n  wrapped',
      '- two',
      'prose',
    ]);
  });

  it('keeps an ordinary hard-wrapped paragraph whole', () => {
    // The inverse defect, and the same cause: splitting by FORMATTING rather than by passage. A
    // paragraph stating a loop on one line and its escape on the next was flagged for lacking what
    // it said one wrap away — an accusation granted by coincidence instead of an exemption.
    expect(passages('first line\nsecond line')).toEqual(['first line\nsecond line']);

    expect(
      judgeRule({
        name: 'research.md',
        text: 'The orchestrator AUTO-re-drives the researcher toward convergence, and\nescapes when the same finding set recurs unchanged.',
      }),
    ).toEqual([]);
  });

  it('accepts a loop paragraph that states the escape, or points at the rule that owns it', () => {
    expect(
      judgeRule({
        name: 'research.md',
        text: '- **Loop-back is hybrid.** It AUTO-re-drives; if the same finding set recurs unchanged, stop.\n',
      }),
    ).toEqual([]);

    expect(
      judgeRule({
        name: 'research.md',
        text: '- **Loop-back is hybrid.** It AUTO-re-drives, escaping per [x](enforcement-architecture.md).\n',
      }),
    ).toEqual([]);
  });

  it('holds the OWNING rule to defining the escape, not to restating it per paragraph', () => {
    // Demanding every paragraph of the definition restate the definition is the restatement defect
    // this harness files items about.
    expect(
      judgeRule({
        name: '.agents/rules/enforcement-architecture.md',
        text: '- **Auto-re-drive.** The orchestrator re-runs the worker.\n\nIts escape is no-progress detection.\n',
      }),
    ).toEqual([]);

    const undefined_ = judgeRule({
      name: '.agents/rules/enforcement-architecture.md',
      text: '- **Auto-re-drive.** The orchestrator re-runs the worker until it converges.\n',
    });
    expect(undefined_.map((f) => f.kind)).toEqual(['the-escape-has-no-owner']);
  });
});

describe('over the tree it governs', () => {
  it('refuses a root with no skills, and one with no map', () => {
    // Fail closed on both. A population read from a directory that is not there is empty, and an
    // empty population is a pass that examined nothing.
    const dir = makeTemp('loops-');
    scratch.push(dir);
    expect(() => scanLoops(dir)).toThrow(/\.agents\/skills does not exist/);

    mkdirSync(path.join(dir, '.agents/skills/probe'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/skills/probe/SKILL.md'), skill('description: x'));
    expect(() => scanLoops(dir)).toThrow(/orchestration-map\.md does not exist/);

    mkdirSync(path.join(dir, '.agents/specs'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/specs/orchestration-map.md'), '# no table here\n');
    expect(() => scanLoops(dir), 'a map with no rows passed as a map').toThrow(/no pipeline rows/);
  });

  it('finds every loop in this tree declared, implemented and agreed with the map', () => {
    const { findings, examined, loops } = scanLoops();

    expect(examined, 'the scan examined almost no skills').toBeGreaterThan(20);
    expect(loops, 'the scan found no loops, which the audit measured otherwise').toBeGreaterThan(
      10,
    );
    expect(findings).toEqual([]);
  });

  it('parses a declaration into its fields', () => {
    expect(
      parseDeclaration(skill('loop: over=finding-set; escape=no-progress; bound=2 rounds')),
    ).toEqual({
      over: 'finding-set',
      escape: 'no-progress',
      bound: '2 rounds',
    });
    expect(parseDeclaration(skill('description: x'))).toBeUndefined();
  });

  it('is registered, so it runs', () => {
    const registry = readFileSync(
      path.resolve(import.meta.dirname, '../run-all-scans.mjs'),
      'utf8',
    );

    expect(registry).toContain('scan-loop-contract.mjs');
  });
});
