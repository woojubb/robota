import { describe, expect, it } from 'vitest';

import {
  addedRuleSections,
  judgeSections,
  resolveBaseRef,
} from '../scan-new-rule-declares-enforcement.mjs';

/**
 * A rule added to this repository says how it is enforced — or says that it is not, and why.
 *
 * `lesson-to-harness` step 8 already required exactly this: prose alone never closes a lesson, and a
 * rule reaches one of two terminal states. Nothing checked it, so the step was skippable — and it
 * was skipped in the session that produced this file, when a rule landed as three paragraphs with no
 * mechanism, no filed item, and no statement that it had neither. It read exactly like a rule
 * something enforced.
 */
const diffFor = (file, lines) =>
  `diff --git a/${file} b/${file}\n+++ b/${file}\n${lines.join('\n')}\n`;

describe('what the diff adds', () => {
  it('sees a new rule section and the lines under it', () => {
    const sections = addedRuleSections(
      diffFor('.agents/rules/operational.md', ['+### A New Rule', '+body line']),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('A New Rule');
    expect(sections[0].body).toContain('body line');
  });

  it('ignores a document that is not a rule', () => {
    expect(addedRuleSections(diffFor('.agents/skills/x/SKILL.md', ['+### A Step']))).toEqual([]);
  });

  it('counts only ADDED lines toward the body', () => {
    // A declaration that was already in the file, under a different section, must not excuse the new
    // one. Unchanged context carries no `+`, so it never reaches the body.
    const sections = addedRuleSections(
      diffFor('.agents/rules/operational.md', ['+### A New Rule', ' Enforced by: `something-old`']),
    );

    expect(sections[0].body).not.toContain('Enforced by');
  });

  it('does not let one section answer for the next', () => {
    const sections = addedRuleSections(
      diffFor('.agents/rules/operational.md', [
        '+### Declared',
        '+Enforced by: `some-scan`',
        '+### Undeclared',
        '+no answer here',
      ]),
    );

    expect(judgeSections(sections).map((f) => f.title)).toEqual(['Undeclared']);
  });
});

describe('the two terminal states, and nothing else', () => {
  const section = (body) => [{ file: '.agents/rules/x.md', title: 'R', body }];

  it('accepts a named mechanism', () => {
    expect(judgeSections(section('Enforced by: `some-scan`\n'))).toEqual([]);
  });

  it('accepts an honest nothing WITH a reason, because that is an answer', () => {
    // The point of the field. A recorded "no machine can decide this" is a decision; the same state
    // unrecorded is indistinguishable from a rule someone believes is enforced.
    expect(
      judgeSections(section('Enforced by: nothing — it leaves no trace in the tree\n')),
    ).toEqual([]);
  });

  it('refuses a nothing with no reason', () => {
    expect(judgeSections(section('Enforced by: nothing\n'))).toHaveLength(1);
  });

  it('refuses silence, which is what a reader cannot tell from enforcement', () => {
    expect(judgeSections(section('Three paragraphs of good advice.\n'))).toHaveLength(1);
  });
});

describe('the base it compares against', () => {
  it('prefers an explicit ref, then the pull request base, then develop', () => {
    expect(resolveBaseRef({ argv: ['--base-ref', 'origin/main'], env: {} })).toBe('origin/main');
    expect(resolveBaseRef({ argv: [], env: { GITHUB_BASE_REF: 'main' } })).toBe('origin/main');
    expect(resolveBaseRef({ argv: [], env: {} })).toBe('origin/develop');
  });
});
