import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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

  it('does not read a FORM as a path', () => {
    // `PATHISH`'s character classes already exclude `< > * ? { }`, so a placeholder never reaches the
    // path check. A second test for the same property used to sit below it and could not run —
    // review found it, and it is the same dead-check shape this change removed elsewhere. The
    // property is asserted here instead of guarded twice.
    expect(pathClaims('rename `src/<name>.ts` for clarity')).toEqual([]);
    expect(pathClaims('touch `a{b}.ts` and `x*.ts`')).toEqual([]);
    // And a real path still reads, so the assertion is not vacuous.
    expect(pathClaims('touch `ok/path.ts`')).toEqual(['ok/path.ts']);
  });

  it('does not read a cited PATH as a commit as well', () => {
    // Review found this, and it is the guard firing on correct work in a REQUIRED check: a file whose
    // STEM happens to be hex-shaped was read twice — correctly as a path, and again as a commit that
    // names nothing — so an accurate message citing a real file was refused for a hash it never wrote.
    //
    // A hyphen in the stem shields it (`scan-c0ffee1.mjs` never matched, and the reviewer's own
    // example was that shape), which is exactly why this needed measuring rather than reasoning: the
    // shapes that DO reproduce are the ones where the hex run is the whole stem.
    expect(commitishClaims('fix: rename `c0ffee1.mjs`')).toEqual([]);
    expect(commitishClaims('fix: touch `src/a1b2c3d.ts`')).toEqual([]);
    expect(commitishClaims('fix: see `docs/deadb33f.md`')).toEqual([]);

    // And the citation this file exists for still reads, including one beside a path.
    expect(commitishClaims('fix: `c0ffee1.mjs`, see abc1234')).toEqual(['abc1234']);
    // A code-spanned token that is NOT a path claim is still a citation — a hash in backticks is the
    // ordinary way to write one, and excluding whole code spans would blind the check to it.
    expect(commitishClaims('fix: reverts `abc1234`')).toEqual(['abc1234']);
  });

  it('does not refuse a citation when GIT ITSELF could not answer', () => {
    // Review found the catch treating ANY git failure as "not found". A non-zero exit from
    // `cat-file -t` IS an answer — no such object — and refusing is correct. Git being absent is not
    // an answer, and reading it as absence refuses a good citation on a REQUIRED check.
    //
    // Measured by pointing the check at a directory that is not a repository, with PATH intact: git
    // runs, exits non-zero, and that is a real answer, so the token IS refused. The outage case is
    // the one above it in the code — it throws rather than returning empty — and this case pins the
    // boundary between them by asserting the ANSWERING side still answers.
    const notARepo = makeTemp('claims-not-a-repo-');
    try {
      expect(objectIsKnown('0123456789abcdef0123456789abcdef01234567', { root: notARepo })).toBe(
        false,
      );
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
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

  it('does not read a dotted API NAME as a path', () => {
    // The rule refused its OWN commit over `path.relative`, which is a function call, not a file.
    // The loose `\.[A-Za-z0-9]+` spelling read every dotted identifier as a path — `path.join`,
    // `fs.existsSync`, `Object.keys` — and commit messages about JavaScript are made of those.
    //
    // A SLASHLESS token must now end in a known extension. A token WITH a slash keeps the loose
    // rule: a slash says "path" on its own.
    for (const token of ['path.relative', 'path.join', 'fs.existsSync', 'Object.keys']) {
      expect(pathClaims(`see \`${token}\` here`), token).toEqual([]);
    }

    // And the shapes the rule exists for are untouched.
    for (const token of [
      'AGENTS.md',
      'commitlint.config.js',
      'pnpm-lock.yaml',
      'scripts/harness/run-all-scans.mjs',
      'packages/agent-core/src/index.ts',
    ]) {
      expect(pathClaims(`see \`${token}\` here`), token).toEqual([token]);
    }
  });

  it('REFUSES a token that escapes the repository', () => {
    // Review: `PATHISH` allows a leading `.` and inner `/`, and `../../../etc/hosts.conf` has an
    // extension-shaped last segment, so `hasStem` passes it too — and the token then reached
    // `existsSync(path.join(root, token))`, which resolves OUTSIDE the checkout.
    //
    // Two things wrong with that. It made a commit message a file-existence oracle for the host
    // filesystem, and it let a citation "resolve" against a file this repository does not contain —
    // the check reporting a pass it had no basis for.
    //
    // The answer to "does this repository contain `../../etc/passwd`" is no, whatever the host
    // happens to hold, so these are refused like any other token naming nothing here.
    // The token must name something that ACTUALLY EXISTS outside the root, or the case passes with
    // or without the guard — measured, my first version used `/etc/hosts.conf`, which exists on no
    // host here, so `existsSync` answered false either way and the case proved nothing.
    //
    // A scratch file outside the checkout, created by this case, so the assertion does not depend
    // on what the host happens to have lying around.
    const outside = makeTemp('outside-the-repo-');
    writeFileSync(path.join(outside, 'target.md'), 'reachable only by escaping the root\n');
    try {
      const escaping = path.relative(WORKSPACE_ROOT, path.join(outside, 'target.md'));
      expect(escaping.startsWith('..'), 'the fixture did not escape the root').toBe(true);
      expect(existsSync(path.join(WORKSPACE_ROOT, escaping)), 'the fixture is unreachable').toBe(
        true,
      );

      expect(pathHasEverExisted(escaping), escaping).toBe(false);
      expect(pathHasEverExisted(path.join(outside, 'target.md')), 'absolute').toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not mistake a SIBLING directory for an inside path', () => {
    // Why containment is `path.relative` and not a string prefix: `/repo-evil` starts with `/repo`.
    expect(pathHasEverExisted('../robota-evil/AGENTS.md')).toBe(false);
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
  const dir = makeTemp('commit-claims-');
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

describe('what the citation shape refuses to read as a commit', () => {
  // This rule is a REQUIRED status check, so a token it reads as a citation and cannot resolve
  // refuses an otherwise correct commit. MEASURED over this repository's last 3000 messages: the
  // digit-only shape matched 93 tokens and 45 occurrences did not resolve. Both narrowings below
  // keep all 48 real citations and cut the false refusals to 7.
  const cite = (message) => commitishClaims(message);

  it('does not read an all-DIGIT token as a hash', () => {
    // GitHub Actions run ids, issue numbers, timestamps, byte counts. A 7-digit all-numeric SHA-1
    // prefix has odds of about one in 270 million; a run id in a commit message is a certainty.
    expect(cite('see run 30195049439 for the failure')).toEqual([]);
    expect(cite('1700000000000 ms')).toEqual([]);
  });

  it('does not read a CHECKSUM length as a hash', () => {
    // 32 is an MD5 and 64 a SHA-256, and both appear in messages. A person cites 7-12 characters or
    // the whole 40.
    expect(cite('integrity c7597884fdba1815ca9319c967d909e2 changed')).toEqual([]);
    expect(cite(`sha256 ${'a1'.repeat(32)} pinned`)).toEqual([]);
  });

  it('still reads the shapes a person actually writes', () => {
    expect(cite('fixed in abc1234')).toEqual(['abc1234']);
    expect(cite('fixed in abc1234def0')).toEqual(['abc1234def0']);
    expect(cite(`reverts ${'0abcdef'.repeat(5) + 'abcde'}`)).toHaveLength(1);
  });

  it('does NOT read a hyphenated fragment, and that is the cheaper error', () => {
    // `-` counts as an identifier character in the boundary, so `abc1234-followup` is missed. Review
    // asked whether it should be. Dropping `-` would admit the hash-like fragment build output is
    // full of — `index-a1b2c3d4.js` — and a message naming a bundle would be refused for citing a
    // commit nobody mentioned. A miss costs an unchecked citation; that costs a correct commit.
    expect(cite('see abc1234-followup for it')).toEqual([]);
    expect(cite('the bundle index-a1b2c3d4.js grew')).toEqual([]);
  });
});

describe('a template slot is a form, not a citation', () => {
  it('does not read a documented naming convention as a path claim', () => {
    // The live case review supplied: `ADR-NNN-short-title.md` is the convention string
    // `.agents/skills/architecture-decision-records/SKILL.md` documents, and a commit message
    // explaining it was refused on this REQUIRED check. The sibling named-artifact scan already
    // excluded slots; this module did not — the answered-differently fork the shared lib exists
    // to prevent, and `isTemplateSlot` now lives there with one spelling.
    expect(pathClaims('docs follow `ADR-NNN-short-title.md` from now on')).toEqual([]);
    expect(pathClaims('name it `<package>.config.json` per convention')).toEqual([]);
  });

  it('still reads a real backticked file as a claim', () => {
    expect(pathClaims('see `commitlint.config.js` for the rule')).toEqual(['commitlint.config.js']);
  });
});
