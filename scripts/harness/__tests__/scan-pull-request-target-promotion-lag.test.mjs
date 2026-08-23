/**
 * A `pull_request_target` workflow runs the default branch's copy of itself (issue #2039).
 *
 * The tree has NO delta as this lands — the promotion carried both fixes minutes before. So every
 * case here CONSTRUCTS one rather than reading the tree, which is also the honest way round: a case
 * that passed because the tree happened to differ would stop testing anything the moment it agreed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  comparableBody,
  findPromotionLagAt,
  readExamined,
  triggersFromPullRequestTarget,
} from '../scan-pull-request-target-promotion-lag.mjs';

describe('which workflows are in scope', () => {
  it.each([
    ['on:\n  pull_request_target:\n    branches: [main]\n', true],
    ['on:\n  pull_request:\n    branches: [main]\n', false],
    ['on:\n  schedule:\n    - cron: "0 0 * * *"\n', false],
  ])('reads the trigger off the `on:` block', (text, expected) => {
    expect(triggersFromPullRequestTarget(text)).toBe(expected);
  });

  it('does not match a mention of the string outside the `on:` block', () => {
    // The same trap `scan-workflow-provenance` documents: a job step or a comment naming the trigger
    // is not the trigger, and a substring search would call every file that discusses this one a
    // member of the set.
    expect(
      triggersFromPullRequestTarget(
        'on:\n  push:\n\njobs:\n  x:\n    steps:\n      - run: echo pull_request_target:\n',
      ),
    ).toBe(false);
  });
});

describe('what counts as a difference', () => {
  it('ignores a reworded comment — a rationale change is not a behaviour change', () => {
    const a = '# one reason\non:\n  pull_request_target:\n';
    const b = '# a different reason entirely\non:\n  pull_request_target:\n';
    expect(comparableBody(a)).toBe(comparableBody(b));
  });

  it('ignores blank lines and trailing whitespace', () => {
    expect(comparableBody('on:\n\n  pull_request_target:   \n\n')).toBe(
      comparableBody('on:\n  pull_request_target:\n'),
    );
  });

  it('SEES a trailing comment removed from a line that also has code', () => {
    // The half that matters: `types: [a]  # why` and `types: [a, b]  # why` differ in the code, and
    // stripping the comment must not take the code with it.
    expect(comparableBody('types: [a]  # why')).not.toBe(comparableBody('types: [a, b]  # why'));
  });

  it.each([
    ['a trigger type added', 'types: [opened]', 'types: [opened, edited]'],
    ['a checkout ref pinned', 'with:\n  x: 1', 'with:\n  ref: ${{ base.sha }}\n  x: 1'],
    ['a permission narrowed', 'permissions:\n  contents: write', 'permissions:\n  contents: read'],
    ['the run line changed', 'run: node a.mjs', 'run: node a.mjs --base-ref x'],
  ])('SEES %s', (_label, before, after) => {
    // Four kinds, and only the first two are what today's fixes touched. The comparison is whole-file
    // on purpose: a curated list of load-bearing fields would encode today's two changes as the
    // definition of load-bearing, and the next inert fix would print a delta and pass.
    expect(comparableBody(before)).not.toBe(comparableBody(after));
  });
});

describe('the verdict for one workflow, against a real git repository', () => {
  /*
   * A temporary repository with two real refs, because `promotionLag` shells out to git and the
   * property under test is what `git show <ref>:<path>` returns. A stub would be asserting the stub.
   *
   * The first cut of these three cases used a fake that returned a fixed value — it passed, proved
   * nothing, and one of them failed only because the fixture disagreed with itself. Replaced rather
   * than deleted: the cases are the right cases, the harness was the wrong one.
   */
  const TARGET = 'on:\n  pull_request_target:\n    branches: [main]\n';

  function makeRepo({ head, promotion }) {
    const dir = makeTemp('robota-prt-lag-');
    const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'probe@example.invalid');
    run('config', 'user.name', 'probe');
    mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    const write = (text) => writeFileSync(path.join(dir, '.github/workflows/w.yml'), text);

    if (promotion !== null) {
      write(promotion);
      run('add', '-A');
      run('commit', '-qm', 'promotion state');
    } else {
      writeFileSync(path.join(dir, 'placeholder'), 'x');
      run('add', '-A');
      run('commit', '-qm', 'no workflow yet');
    }
    run('branch', '-f', 'promotion-ref');

    write(head);
    // An unrelated file so the second commit exists even when `head` and `promotion` are identical
    // — which is the `promoted` case, and the one where "no change to commit" would fail the setup
    // rather than the assertion.
    writeFileSync(path.join(dir, 'head-marker'), 'x');
    run('add', '-A');
    run('commit', '-qm', 'head state');
    return dir;
  }

  function lagIn(fixture) {
    // No `chdir`: the root is a parameter, which is the whole reason it was made one. An earlier
    // cut changed the process directory instead and passed alone, then failed under the suite —
    // vitest runs it in a worker, where `process.chdir` throws.
    return findPromotionLagAt(makeRepo(fixture), 'HEAD', 'promotion-ref');
  }

  it('reports `promoted` when the two copies agree', () => {
    expect(lagIn({ head: TARGET, promotion: TARGET })).toEqual([
      { file: '.github/workflows/w.yml', state: 'promoted' },
    ]);
  });

  it('reports `lagging` when they differ', () => {
    expect(
      lagIn({
        head: TARGET,
        promotion: 'on:\n  pull_request_target:\n    branches: [develop]\n',
      }),
    ).toEqual([{ file: '.github/workflows/w.yml', state: 'lagging' }]);
  });

  it('reports `absent` when the promotion ref does not carry the file at all', () => {
    // Its own state, not a delta: never promoted is a stronger statement than differs, and folding
    // them together would let "none of this is live" read as "some of this is old".
    expect(lagIn({ head: TARGET, promotion: null })).toEqual([
      { file: '.github/workflows/w.yml', state: 'absent' },
    ]);
  });

  it('REFUSES an unreadable promotion ref rather than reporting no delta', () => {
    // The distinction this whole session has been about: "could not compare" is not "nothing to
    // compare". Building that confusion into the check whose subject is exactly this would be its
    // own instance.
    const dir = makeRepo({ head: TARGET, promotion: TARGET });
    expect(() => findPromotionLagAt(dir, 'HEAD', 'no-such-ref')).toThrow(/could not/i);
  });
});

describe('the reported size', () => {
  /*
   * The `::examined::` number is the only part of this check's coverage claim a reader can act on,
   * so it is asserted as an output: an EXACT value against a fixture of known size, and again after
   * a second walk. A bound would be met by an over-count, and a counter that accumulates rises
   * monotonically while reading like growing coverage.
   */
  const TARGET = 'on:\n  pull_request_target:\n    branches: [main]\n';
  const NOT_TARGET = 'on:\n  pull_request:\n    branches: [main]\n';

  function repoWith(files) {
    const dir = makeTemp('robota-prt-size-');
    const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'probe@example.invalid');
    run('config', 'user.name', 'probe');
    mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(path.join(dir, '.github/workflows', name), text);
    }
    run('add', '-A');
    run('commit', '-qm', 'fixture');
    run('branch', '-f', 'promotion-ref');
    return dir;
  }

  // THREE of the five trigger from `pull_request_target`; the number must be the subject's size,
  // not the directory's, so the two non-subjects are what make this fixture able to fail.
  const dir = repoWith({
    'a.yml': TARGET,
    'b.yml': TARGET,
    'c.yml': TARGET,
    'd.yml': NOT_TARGET,
    'e.yml': NOT_TARGET,
  });

  it('counts the workflows the walk actually visited', () => {
    findPromotionLagAt(dir, 'HEAD', 'promotion-ref');
    expect(readExamined()).toBe(3);
  });

  it('starts from zero on a second walk rather than accumulating', () => {
    findPromotionLagAt(dir, 'HEAD', 'promotion-ref');
    findPromotionLagAt(dir, 'HEAD', 'promotion-ref');
    expect(readExamined()).toBe(3);
  });

  it('reports zero, not the previous walk, when a tree holds no such workflow', () => {
    // The direction the rule names: a number that survives a walk which read nothing is the one
    // that reads steadier than the coverage it stands for.
    const empty = repoWith({ 'only.yml': NOT_TARGET });
    findPromotionLagAt(dir, 'HEAD', 'promotion-ref');
    findPromotionLagAt(empty, 'HEAD', 'promotion-ref');
    expect(readExamined()).toBe(0);
  });
});
