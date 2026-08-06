import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// allow-missing-artifact-file: every path in this file is an invented fixture — the case is what a claim looks like

import {
  commitishClaims,
  judgeMessage,
  objectIsKnown,
  pathClaims,
  pathHasEverExisted,
} from '../commit-message-claims.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * HARNESS-076 — a commit message describes the DIFF, not the intent.
 *
 * Twice in one session a message asserted something that had not happened: once it said an edit had
 * been recorded in a document while the edit's own script had failed its assertion and written
 * nothing, and once a reply cited a commit hash that was typed rather than read. Both were found by
 * someone else.
 *
 * A message is the record the next reader trusts INSTEAD of reading the diff, so a false one does
 * not merely fail to inform — it substitutes for looking.
 */
const WORLD = {
  resolvesObject: (token) => token === 'abc1234',
  pathKnown: (token) => token === 'scripts/harness/real.mjs',
};

describe('what counts as a citation', () => {
  it('reads a commit-ish token out of the body, where citations live', () => {
    expect(commitishClaims('fix: x\n\nsee abc1234 for the reason')).toEqual(['abc1234']);
  });

  it('reads a WHOLE token, not a window inside a longer identifier', () => {
    // `\\b` alone let a 7-character run be found inside a longer identifier, so an ordinary word
    // could be read as a citation and refused for naming a commit nobody mentioned.
    expect(commitishClaims('the build0aded1234567890 identifier')).toEqual([]);
    expect(commitishClaims('commit abc1234.')).toEqual(['abc1234']);
    expect(commitishClaims('ref: 0f4a123, then')).toEqual(['0f4a123']);
  });

  it('does not read a number as an object name', () => {
    // A count, a year, an issue number. `1234567` is hex-shaped and is not a hash.
    expect(commitishClaims('closes 1234567 issues')).toEqual([]);
  });

  it('does not read a fixture word that happens to be hex', () => {
    // Once a digit is required these are excluded by the pattern itself, so the explicit list that
    // used to name them was unreachable — dead code asserting a property something else already
    // provided. Review found it; the list is gone and the property is asserted here instead.
    expect(commitishClaims('the `deadbeef` fixture')).toEqual([]);
    expect(commitishClaims('the facefeed and baddcafe fixtures')).toEqual([]);
  });

  it('does not refuse a citation it cannot check, in a shallow clone', () => {
    // `git log` cannot search a history that was not fetched, so "no commit touched this path"
    // would mean "the history is not here" — and refusing a correct citation for that, in a
    // REQUIRED check, is a guard firing on correct work. Unknown is not absent.
    expect(pathHasEverExisted('anything/at/all.mjs', { isShallowOverride: true })).toBe(true);
  });

  it('does not refuse a cited OBJECT it cannot check, in a shallow clone', () => {
    // Review found the two halves disagreeing. The PATH side already treated a shallow clone as
    // unable to answer, but the OBJECT side did not — and a shallow clone holds only a handful of
    // recent commits, so a message correctly citing an older one named an object the checkout
    // genuinely does not have. Same missing history, same required check, opposite verdicts.
    //
    // A hash of the right shape that no repository has ever held stands in for the older commit:
    // if the shallow tolerance were absent this refuses, which is the guard firing on correct work.
    expect(
      objectIsKnown('0000000000000000000000000000000000000123', { isShallowOverride: true }),
    ).toBe(true);
    // And with a real history it still answers, so the tolerance did not turn the check off.
    expect(
      objectIsKnown('0000000000000000000000000000000000000123', { isShallowOverride: false }),
    ).toBe(false);
  });

  it('does not read an ordinary English word built from a-f', () => {
    // Review found this: `defaced`, `acceded`, `effaced` are seven letters from a-f, so an ordinary
    // sentence would have been refused for citing a commit it never mentioned — a guard firing on
    // correct work, which is the failure that gets a guard turned off.
    //
    // The fix requires a DIGIT rather than scoping to code spans. Scoping was the other candidate
    // and costs more than it saves: the citation that started this — a hash typed rather than read —
    // was written in running prose, so a code-span-only matcher would miss the very incident it
    // exists for. A hash with no digit at all goes unchecked; a miss is the cheaper error here.
    expect(commitishClaims('the defaced and acceded and effaced parts')).toEqual([]);
    expect(commitishClaims('see abc1234 for it')).toEqual(['abc1234']);
  });

  it('reads a repository path only from a code span', () => {
    // Prose names things loosely — "the harness scripts directory" — and reading that as a path
    // would fire on every sentence. A path claim in this repository is code-formatted.
    expect(pathClaims('edits `scripts/harness/x.mjs` under scripts/harness/')).toEqual([
      'scripts/harness/x.mjs',
    ]);
  });

  it('reads a bare top-level filename, which is a path claim one level up', () => {
    // A slash is not what makes a token a path. `AGENTS.md` and `commitlint.config.js` are cited in
    // commit messages constantly and went unchecked — the same false claim this file exists to
    // catch, in the directory most messages mention.
    expect(pathClaims('edits `AGENTS.md` and `commitlint.config.js`')).toEqual([
      'AGENTS.md',
      'commitlint.config.js',
    ]);
  });

  it('does not read a SHAPE a file ends with as a file', () => {
    // Measured on this repository's own continuous integration: the commit that shipped the first
    // half of this rule was refused by it, for naming `.test.ts` while explaining a convention.
    // Two checks needed the same answer and each had grown its own — the judgement is shared now,
    // because a second spelling of "what counts as a file name" is a second answer waiting to
    // disagree, and here it disagreed the moment the second caller existed.
    expect(pathClaims('names `.test.ts` and `.d.ts`')).toEqual([]);
    expect(pathClaims('names `.eslintrc.json`')).toEqual(['.eslintrc.json']);
  });

  it('still does not read a word that names no file', () => {
    expect(pathClaims('the `harness` directory')).toEqual([]);
  });

  it('does not read a form standing in for a path', () => {
    expect(pathClaims('add `packages/<pkg>/docs/SPEC.md`')).toEqual([]);
  });
});

describe('the two claims a machine can check', () => {
  it('refuses a hash that names no object', () => {
    const findings = judgeMessage('fix: x\n\nsee 0f4a123 for it', WORLD);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('commitish-names-nothing');
  });

  it('refuses a path that exists neither in the tree nor in the change', () => {
    // The shape that caught the real incident: the message says the item now records something, the
    // item is named, and the commit never touched it — because the edit silently did not land.
    const findings = judgeMessage('docs: x\n\nrecorded in `scripts/harness/imaginary.mjs`', WORLD);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('path-names-nothing');
  });

  it('accepts a path this commit touches even though the tree does not have it yet', () => {
    // A file ADDED by the commit is a legitimate citation. Requiring it to pre-exist would refuse
    // every message that introduces a file — a guard firing on correct work.
    const staged = { ...WORLD, pathKnown: (token) => token === 'scripts/harness/new.mjs' };

    expect(judgeMessage('feat: x\n\nadds `scripts/harness/new.mjs`', staged)).toEqual([]);
  });

  it('says nothing about a message that cites nothing', () => {
    expect(judgeMessage('chore: tidy up\n\nNo citations here.', WORLD)).toEqual([]);
  });
});

describe('which tree the path is judged against', () => {
  // Review found the first version judging against the wrong one, in the place that matters:
  // continuous integration lints each commit of a pull request by piping its message into
  // commitlint WITHOUT checking that commit out. The working tree stays at HEAD for every message,
  // so `--cached` is empty and "does it exist" answers about the wrong tree — a message correctly
  // naming a file its own commit added would fail once a later commit renamed it, and one naming a
  // file only a LATER commit created would pass.
  it('accepts a path that exists now', () => {
    expect(pathHasEverExisted('scripts/harness/run-all-scans.mjs')).toBe(true);
  });

  it('accepts a path that USED to exist, because a commit may legitimately cite what it removed', () => {
    // Measured against a real deletion: a workflow removed by INFRA-058. Under the old check every
    // message that had ever named it would have started failing the moment it was deleted.
    expect(pathHasEverExisted('.github/workflows/deploy.yml')).toBe(true);
  });

  it('still refuses a path that has never existed anywhere', () => {
    expect(pathHasEverExisted('scripts/harness/never-was.mjs')).toBe(false);
  });

  it('says out loud when a shallow clone leaves the question unasked', () => {
    // It does not refuse — refusing a correct citation because the history was not fetched is a
    // guard firing on correct work, in a required check. But a reader looking at a green run
    // deserves to know a question went unasked, so it is written to stderr rather than passed over.
    const said = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      said.push(String(chunk));
      return true;
    };
    try {
      expect(pathHasEverExisted('anything/at/all.mjs', { isShallowOverride: true })).toBe(true);
    } finally {
      process.stderr.write = original;
    }

    expect(said.join('')).toMatch(/shallow clone/);
  });

  it('accepts a staged path before it is anywhere else', () => {
    expect(
      pathHasEverExisted('scripts/harness/brand-new.mjs', {
        staged: new Set(['scripts/harness/brand-new.mjs']),
      }),
    ).toBe(true);
  });
});

describe('the rule is wired where commits actually pass through', () => {
  it('commitlint refuses a message whose citations resolve to nothing', () => {
    // The end-to-end form. A unit test over `judgeMessage` proves the judgement; this proves the
    // judgement is REACHED — by the command the hook and the required check both run.
    const result = runCommitlint(
      'fix(x): probe\n\nsee 0f4a1234567 and `scripts/harness/definitely-not-here.mjs`\n',
    );

    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/claims-resolve/);
  });

  it('leaves an ordinary message alone', () => {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    }).trim();
    const result = runCommitlint(
      `fix(x): ordinary\n\nEdits \`scripts/harness/run-all-scans.mjs\`, after ${head}.\n`,
    );

    expect(result.output).not.toMatch(/claims-resolve/);
  });
});

function runCommitlint(message) {
  const dir = mkdtempSync(path.join(tmpdir(), 'commit-claims-'));
  const file = path.join(dir, 'MSG');
  writeFileSync(file, message);
  try {
    const output = execFileSync('npx', ['commitlint', '--edit', file], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output };
  } catch (error) {
    return { status: error.status ?? -1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
