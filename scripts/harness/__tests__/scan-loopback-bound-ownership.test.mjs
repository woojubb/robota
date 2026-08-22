/**
 * HARNESS-072 (#1617) — each check red-proved against the actual historical contradiction it
 * targets, per the issue's own test plan. The fixtures are the REAL text, cited to its commit,
 * embedded rather than read from history so a shallow clone judges the same thing CI does.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { collectFindings, mapLoopbackCells } from '../scan-loopback-bound-ownership.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

const TABLE_HEADER = [
  '| Pipeline | Orchestrator (skill) | Worker(s) | Guardian(s) → signal | Loop-back | Floor (scan/hook) |',
  '| --- | --- | --- | --- | --- | --- |',
].join('\n');

function world({ mapRows = [], ruleLines = [], skills = ['pr-finding-resolution-loop'] } = {}) {
  const root = makeTemp('loopback-');
  scratch.push(root);
  mkdirSync(path.join(root, '.agents/specs'), { recursive: true });
  mkdirSync(path.join(root, '.agents/rules'), { recursive: true });
  for (const name of skills) {
    mkdirSync(path.join(root, '.agents/skills', name), { recursive: true });
  }
  writeFileSync(
    path.join(root, '.agents/specs/orchestration-map.md'),
    `# Map\n\n${TABLE_HEADER}\n${mapRows.join('\n')}\n`,
  );
  writeFileSync(path.join(root, '.agents/rules/some-rule.md'), ruleLines.join('\n'));
  return root;
}

describe('the map does not restate a bound', () => {
  it('flags the historical post-merge cell — the map at 4cc72938f', () => {
    // Verbatim from `.agents/specs/orchestration-map.md` at 4cc72938f, the commit the issue names:
    // the cell states "2 base re-cuts" while post-merge-cycle states "bounded at 2 attempts" — two
    // statements of one fact, which is #1615's whole mechanism.
    const root = world({
      mapRows: [
        '| **Post-merge cycle** | `post-merge-cycle` | (in the skill) | `merge-verifier` → MERGE VERIFIED | auto → bounded (2 base re-cuts); halt on a FAIL landing verdict or an exhausted bound | branch-guard |',
      ],
    });

    const { findings } = collectFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('2 base re-cuts');
  });

  it('flags the round-8 shape — a cap the owning skill had already removed', () => {
    // The #1615 round-8 contradiction: the map said `bounded (max 3 + progress detection)` after
    // the owner directive removed the cap from the owning skill. Rules outrank nothing here — both
    // documents were normative, and a reader following the map was wrong.
    const root = world({
      mapRows: [
        '| **PR review** | `pr-finding-resolution-loop` | `pr-review-fixer` | `pr-review-reviewer` → ACTIONABLE FINDINGS | auto → resolved, bounded (max 3 + progress detection) | scan-review-findings |',
      ],
    });

    const { findings } = collectFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('max 3');
  });

  it('accepts a cell that says bounded and points at the owner', () => {
    const root = world({
      mapRows: [
        "| **Post-merge cycle** | `post-merge-cycle` | (in the skill) | `merge-verifier` → MERGE VERIFIED | auto → bounded (base re-cuts; the cap is the skill's) | branch-guard |",
      ],
    });

    expect(collectFindings(root).findings).toEqual([]);
  });
});

describe('a rule or spec-doc does not restate a skill’s bound', () => {
  it('flags the rounds-9/10/12 shape — a draft spec restating `max 3 iterations`', () => {
    const root = world({
      mapRows: [
        '| **PR review** | `pr-finding-resolution-loop` | w | g → S | auto → bounded | floor |',
      ],
      ruleLines: [
        'The loop follows `pr-finding-resolution-loop`, bounded at max 3 iterations before escalation.',
      ],
    });

    const { findings } = collectFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.agents/rules/some-rule.md');
  });

  it('flags the HYPHENATED spelling — `max-3` is the same restatement', () => {
    // Measured in the live tree: a draft spec's implementation log wrote `max-3 + progress
    // detection` beside the skill's name, and the space-only regex walked past it — the scan's
    // green then meant "nothing this regex could see", not "no restatement".
    const root = world({
      mapRows: [
        '| **PR review** | `pr-finding-resolution-loop` | w | g → S | auto → bounded | floor |',
      ],
      ruleLines: [
        'Landed the route-only `pr-finding-resolution-loop` skill (synchronous loop, max-3 + progress detection).',
      ],
    });

    const { findings } = collectFindings(root);

    expect(findings, 'the hyphenated bound walked past the scan').toHaveLength(1);
  });

  it('does not read `max N <plain-noun>` as a loop bound', () => {
    // `max 72 chars` is a formatting cap, not an iteration bound — the max branch demands an
    // iteration noun, punctuation or the end after the number, like the noun branch always did.
    const root = world({
      mapRows: [
        '| **PR review** | `pr-finding-resolution-loop` | w | g → S | auto → bounded | floor |',
      ],
      ruleLines: [
        'Messages follow `pr-finding-resolution-loop` guidance with subject lines max 72 chars long.',
      ],
    });

    expect(collectFindings(root).findings, 'a formatting cap was read as a bound').toEqual([]);
  });

  it('does not flag a bound with no skill name beside it', () => {
    // A rule stating ITS OWN bound about its own subject is not a restatement of anyone's.
    const root = world({
      mapRows: [
        '| **PR review** | `pr-finding-resolution-loop` | w | g → S | auto → bounded | floor |',
      ],
      ruleLines: ['Retries are bounded at 2 attempts before the failure is reported.'],
    });

    expect(collectFindings(root).findings).toEqual([]);
  });

  it('honours a reasoned suppression, and only a reasoned one', () => {
    const root = world({
      mapRows: [
        '| **PR review** | `pr-finding-resolution-loop` | w | g → S | auto → bounded | floor |',
      ],
      ruleLines: [
        'The `pr-finding-resolution-loop` example shows max 3 iterations. <!-- allow-restated-bound: worked example, not normative -->',
      ],
    });

    expect(collectFindings(root).findings).toEqual([]);
  });
});

describe('what it refuses to pass over', () => {
  it('throws on a skills tree that exists but is EMPTY — the docstring promises this refusal', () => {
    // A directory with zero skills is the same nothing as a missing one: the restatement sweep
    // would have nothing to compare against and pass over it silently.
    const root = makeTemp('loopback-empty-skills-');
    scratch.push(root);
    mkdirSync(path.join(root, '.agents/specs'), { recursive: true });
    mkdirSync(path.join(root, '.agents/skills'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/specs/orchestration-map.md'),
      '| Pipeline | Orchestrator | Workers | Guardians | Loop-back | Floor |\n| - | - | - | - | - | - |\n| **P** | `alpha` | w | g | auto → bounded | f |\n',
    );

    expect(() => collectFindings(root)).toThrow(/no skill directories/);
  });

  it('throws on a map with no pipeline table', () => {
    const root = makeTemp('loopback-bare-');
    scratch.push(root);
    mkdirSync(path.join(root, '.agents/specs'), { recursive: true });
    mkdirSync(path.join(root, '.agents/skills/x'), { recursive: true });
    writeFileSync(path.join(root, '.agents/specs/orchestration-map.md'), '# Map, tableless\n');

    expect(() => collectFindings(root)).toThrow(/no pipeline table/);
  });

  it('parses the LIVE map and finds its cells', () => {
    const source = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/specs/orchestration-map.md'),
      'utf8',
    );
    expect(mapLoopbackCells(source).length).toBeGreaterThanOrEqual(7);
  });

  it('passes on the LIVE repository', () => {
    const { findings } = collectFindings(WORKSPACE_ROOT);
    expect(findings).toEqual([]);
  });
});
