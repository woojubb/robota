import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { judgeSkill, parseDeclaration, readMapBounds, scanLoops } from '../scan-loop-contract.mjs';

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
    // First mention wins: a row names its orchestrator first and its collaborators after.
    expect(bounds.get('alpha')).toBe('auto → escape: no-progress');
    expect(bounds.get('beta')).toBe('auto → escape: no-progress');
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
});

describe('over the tree it governs', () => {
  it('refuses a root with no skills, and one with no map', () => {
    // Fail closed on both. A population read from a directory that is not there is empty, and an
    // empty population is a pass that examined nothing.
    const dir = mkdtempSync(path.join(tmpdir(), 'loops-'));
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
