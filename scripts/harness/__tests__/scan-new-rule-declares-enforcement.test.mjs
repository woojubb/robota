// allow-missing-artifact-file: every path in this file is an invented fixture — the case is what a
// rule declaration looks like, and naming a real scan would tie these to a file that may be renamed

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveGitBaseRef } from '../shared.mjs';

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

  it('does not let a distant hunk answer for a heading', () => {
    // The body used to accumulate to the next heading ANYWHERE in the file, so a declaration added
    // far away — under a different rule, in a later hunk — answered for this one. The heading and
    // its declaration must arrive together; that is the whole point of asking at the moment a rule
    // is written.
    const diff = [
      'diff --git a/x b/x',
      '+++ b/.agents/rules/x.md',
      '@@ -1,0 +1,2 @@',
      '+### New Rule',
      '+body with no declaration',
      '@@ -50,0 +60,2 @@',
      '+Enforced by: `some-scan`',
      '',
    ].join('\n');

    expect(judgeSections(addedRuleSections(diff)).map((f) => f.title)).toEqual(['New Rule']);
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

  it('accepts a plain hyphen as well as an em dash', () => {
    // The two are semantically identical here. Refusing the hyphen made a required scan reject a
    // correct declaration over a character nobody can see is wrong, and it told the reader the rule
    // was UNDECLARED — which is not what happened.
    expect(judgeSections(section('Enforced by: nothing - it leaves no trace\n'))).toEqual([]);
  });

  it('refuses a nothing with no reason', () => {
    expect(judgeSections(section('Enforced by: nothing\n'))).toHaveLength(1);
  });

  it('refuses silence, which is what a reader cannot tell from enforcement', () => {
    expect(judgeSections(section('Three paragraphs of good advice.\n'))).toHaveLength(1);
  });
});

describe('the base it compares against', () => {
  it('takes an explicit ref as given', () => {
    expect(resolveBaseRef({ argv: ['--base-ref', 'origin/main'] })).toBe('origin/main');
  });

  it('otherwise DELEGATES, rather than answering with a list of its own', () => {
    // This function used to try three candidates and verify none of them, so a run outside a
    // GitHub pull_request context — an agent worktree, a shallow clone, a plain local
    // `pnpm harness:scan` — hard-failed on an `origin/develop` that was simply not fetched. Review
    // pointed at `shared.mjs`'s resolver, which this repository already has: eight candidates, each
    // checked for existence. A fourth spelling of "which ref is the base" is a fourth answer
    // waiting to disagree with the other three.
    //
    // So the case asserts the DELEGATION: with no flag, the answer is the shared resolver's answer,
    // whatever this checkout makes that. Asserting a literal here would be asserting the shared
    // resolver's behaviour a second time, in the file that exists to stop having a second copy.
    expect(resolveBaseRef({ argv: [] })).toBe(resolveGitBaseRef(null));
  });
});

describe('an unreadable base is a refusal, not a skip', () => {
  it('exits non-zero when it cannot read the diff', () => {
    // The comment said "fail closed" and the branch returned without an exit code — a SKIPPED line
    // and a silent pass, which is the state the comment claims to refuse. Review caught it, and it
    // is the same defect INFRA-048 fixed once already in the scan this one is modelled on.
    const result = runScan(['--base-ref', 'does/not/exist']);

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/cannot read the diff/);
  });

  it('does not declare the unread zero as expected-empty', () => {
    // `::expected-empty::` tells the runner a zero is CORRECT. A zero nobody established is not,
    // and marking it so would launder the failure through the very channel this repository added
    // to tell those two apart.
    const result = runScan(['--base-ref', 'does/not/exist']);

    expect(result.output).toMatch(/::examined:: 0 new rule sections/);
    expect(result.output).not.toMatch(/::expected-empty::/);
  });

  it('passes on a readable base, so the refusal is not simply always', () => {
    expect(runScan(['--base-ref', 'origin/develop']).status).toBe(0);
  });
});

function runScan(args) {
  const script = path.resolve(import.meta.dirname, '../scan-new-rule-declares-enforcement.mjs');
  try {
    return { status: 0, output: execFileSync('node', [script, ...args], { encoding: 'utf8' }) };
  } catch (error) {
    return { status: error.status ?? -1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

describe('a rule added under a heading that already existed', () => {
  // Review found this floor firing only on a brand-new `### heading`, which is not how most rules
  // arrive — a rule is usually one more bullet under a section that is already there. A floor that
  // misses the common case is close to no floor.
  const file = '+++ b/.agents/rules/example.md';

  it('is asked for its declaration', () => {
    const diff = [
      file,
      '@@ -1,0 +1,2 @@',
      '+- **A worker MUST declare its scope.**',
      '+  Why it matters.',
    ].join('\n');

    expect(judgeSections(addedRuleSections(diff))).toHaveLength(1);
  });

  it('is satisfied by a declaration that arrives WITH it', () => {
    const diff = [
      file,
      '@@ -1,0 +1,2 @@',
      '+- **A worker MUST declare its scope.**',
      '+  Enforced by: `scan-scope.mjs`',
    ].join('\n');

    expect(judgeSections(addedRuleSections(diff))).toEqual([]);
  });

  it('leaves ordinary prose alone', () => {
    // Every prose edit under a rules heading is an added line. Refusing those would make this fire
    // on correct work, which is what gets a floor turned off — so it asks for an OBLIGATION, not
    // merely a bullet.
    const diff = [
      file,
      '@@ -1,0 +1,1 @@',
      '+- This paragraph explains why the earlier rule exists.',
    ].join('\n');

    expect(judgeSections(addedRuleSections(diff))).toEqual([]);
  });
});

describe('two rules added side by side', () => {
  it("does not let the FIRST bullet's declaration excuse the second", () => {
    // Review: sections only opened when none was already open, so two rule bullets added back to
    // back in one hunk shared a section — and a declaration on the first covered the second. That
    // is the same "a declaration under some other rule is not an answer" the branch was written
    // for, one bullet apart instead of one heading apart.
    const diff = [
      'diff --git a/.agents/rules/thing.md b/.agents/rules/thing.md',
      '--- a/.agents/rules/thing.md',
      '+++ b/.agents/rules/thing.md',
      '@@ -1,2 +1,4 @@',
      ' ## Existing heading',
      '+- **A thing MUST be declared.** Enforced by: `scan-thing`.',
      '+- **A second thing MUST also be declared.**',
    ].join('\n');

    const sections = addedRuleSections(diff);

    expect(sections, 'the two bullets shared one section').toHaveLength(2);
    const undeclared = judgeSections(sections);
    expect(
      undeclared.map((s) => s.title).join(' '),
      "the second rule was excused by the first rule's declaration",
    ).toMatch(/A second thing MUST also be declared/);
  });
});

describe('a heading and its first bullet are one rule', () => {
  const diff = (lines) =>
    [
      'diff --git a/.agents/rules/x.md b/.agents/rules/x.md',
      '+++ b/.agents/rules/x.md',
      '@@ -1 +1 @@',
      ...lines,
    ].join('\n');

  it('does not report the heading as a second, undeclarable section', () => {
    // Review walked the shape: `### New Rule` directly followed by its own MUST bullet produced
    // TWO sections — the heading's body stayed empty forever, so it was reported undeclared no
    // matter where the author put the declaration.
    const sections = addedRuleSections(
      diff([
        '+### New Rule',
        '+- **A worker MUST X.**',
        '+  Enforced by: `scripts/harness/scan-x.mjs`.',
      ]),
    );

    expect(sections).toHaveLength(1);
    expect(judgeSections(sections)).toEqual([]);
  });

  it('lets an intro sentence sit between the heading and its first bullet', () => {
    // Review round two: the first merge demanded an EMPTY body, so one ordinary intro line filled
    // it, the merge was skipped, and the heading was a wall again. What makes the first bullet the
    // heading's rule is that no OTHER rule arrived in between — not that nothing did.
    const sections = addedRuleSections(
      diff([
        '+### New Rule',
        '+Intro sentence about why this rule exists.',
        '+- **A worker MUST X.**',
        '+  Enforced by: `scripts/harness/scan-x.mjs`.',
      ]),
    );

    expect(sections).toHaveLength(1);
    expect(judgeSections(sections)).toEqual([]);
  });

  it('still opens a section for the SECOND bullet under the same heading', () => {
    // The back-to-back case the earlier round closed: a declaration on the first bullet must not
    // excuse the second.
    const sections = addedRuleSections(
      diff([
        '+### New Rule',
        '+- **A worker MUST X.**',
        '+  Enforced by: `scripts/harness/scan-x.mjs`.',
        '+- **A worker MUST Y.**',
      ]),
    );

    expect(sections).toHaveLength(2);
    expect(judgeSections(sections)).toHaveLength(1);
  });
});
