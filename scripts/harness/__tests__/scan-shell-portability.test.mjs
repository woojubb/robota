import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findPortabilityFindings } from '../scan-shell-portability.mjs';

/**
 * The mechanical half of "Host Platform Is Read, Never Assumed" (operational.md). A checked-in
 * script runs on whatever machine clones the repo, and the flags below fail on the other OS WITHOUT
 * naming their cause — `sed -i` on macOS reports success while eating the next argument.
 */
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function fixture(files) {
  const root = makeTemp('portability-');
  roots.push(root);
  for (const dir of ['scripts', '.husky', '.claude/hooks'])
    mkdirSync(path.join(root, dir), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe('scan-shell-portability', () => {
  it('flags each GNU-only flag that fails silently on the other platform', () => {
    const root = fixture({
      'scripts/a.sh': 'sed -i "s/a/b/" f\n',
      'scripts/b.sh': 'readlink -f "$1"\n',
      'scripts/c.sh': 'stat -c %Y f\n',
      'scripts/d.sh': "date -d '1 day ago'\n",
      'scripts/e.sh': 'grep -P "\\d" f\n',
      // The LONG spellings of the same flags. Raised in review of #1590 as an acknowledged gap;
      // closed, because each is the same command with the same platform behaviour.
      'scripts/l1.sh': "sed --in-place 's/a/b/' f\n",
      'scripts/l2.sh': 'stat --format %Y f\n',
      'scripts/l3.sh': 'base64 --wrap=0 f\n',
      'scripts/l4.sh': 'readlink --canonicalize p\n',
      'scripts/l5.sh': 'echo x | xargs --no-run-if-empty rm\n',
      'scripts/f.sh': 'base64 -w0 f\n',
      'scripts/g.sh': 'find . -name x -printf "%p"\n',
      'scripts/h.sh': 'echo x | xargs -r rm\n',
    });
    const { findings } = findPortabilityFindings(root);
    // Every fixture is a finding — the count, so a spelling that stops matching cannot hide behind
    // its sibling in a de-duplicated set.
    expect(findings).toHaveLength(13);
    expect([...new Set(findings.map((f) => f.flag))].sort()).toEqual([
      'base64 -w',
      'date -d',
      'find -printf',
      'grep -P',
      'readlink -f',
      'sed -i',
      'stat -c',
      'xargs -r',
    ]);
  });

  it('leaves the portable spellings alone', () => {
    const root = fixture({
      'scripts/ok.sh': 'sed "s/a/b/" f > f.new\ngrep -E "[0-9]" f\nbase64 f\n',
      '.husky/pre-commit': 'pnpm lint-staged\n',
      '.claude/hooks/guard.sh': 'node scripts/x.mjs\n',
    });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  // STATED LIMIT, pinned so it cannot drift back silently. The first version scanned `.mjs` too and
  // refused a JS STRING LITERAL describing this very scan — a flag named in prose inside a string is
  // indistinguishable from one being run without evaluating the file, and a guard that fires on
  // correct work is one people learn to route around.
  it('examines shell files only, and a JS string naming a flag is not a finding', () => {
    const root = fixture({
      'scripts/prose.mjs': "const why = 'sed -i eats the next argument on macOS';\n",
      'scripts/real.sh': 'sed -i "s/a/b/" f\n',
    });
    const { findings } = findPortabilityFindings(root);
    expect(findings.map((f) => f.file)).toEqual([path.join('scripts', 'real.sh')]);
  });

  // An EXTENSIONLESS husky hook is scanned. The "leaves portable spellings alone" case includes one
  // too, but that passes just as well if the file is never opened — a vacuous green. This one fails
  // if the extensionless branch stops working.
  it('scans an extensionless file that DECLARES itself a shell script', () => {
    const root = fixture({ '.husky/pre-push': '#!/usr/bin/env sh\nstat -c %Y f\n' });
    const { findings } = findPortabilityFindings(root);
    expect(findings.map((f) => `${f.file}:${f.flag}`)).toEqual([
      `${path.join('.husky', 'pre-push')}:stat -c`,
    ]);
  });

  // The property is the FILE's, not its directory's. A directory allowlist left `.claude/hooks` —
  // a governed root — unable to hold an extensionless hook, and compared against the first path
  // segment so a multi-segment root could never have matched even after being added. (#1590 review)
  it('scans an extensionless hook under a MULTI-SEGMENT root, which an allowlist could not', () => {
    const root = fixture({ '.claude/hooks/guard': '#!/bin/bash\nreadlink -f "$0"\n' });
    const { findings } = findPortabilityFindings(root);
    expect(findings.map((f) => f.file)).toEqual([path.join('.claude', 'hooks', 'guard')]);
  });

  // A LEADING dot is not an extension. `.bashrc` matched neither branch — not `.sh`, and never
  // shebang-tested — so a real shell script with that name was skipped in silence. (#1590 review)
  it('shebang-tests a leading-dot filename, which has no extension', () => {
    const root = fixture({ 'scripts/.hookrc': '#!/bin/sh\ndate -d yesterday\n' });
    expect(findPortabilityFindings(root).findings.map((f) => f.flag)).toEqual(['date -d']);
  });

  it('does not treat an extensionless NON-script as a shell script', () => {
    const root = fixture({ '.husky/NOTES': 'stat -c is GNU-only, do not use it\n' });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  // A trailing backslash continues the command, and the shell reads the result as one line. A
  // line-by-line match saw neither half and passed — a portability bug in silence, which is the
  // class this scan is for. (Review of #1590.)
  it('follows a LINE CONTINUATION, and reports the line the command started on', () => {
    const root = fixture({ 'scripts/cont.sh': "sed \\\n  -i 's/a/b/' f\n" });
    const { findings } = findPortabilityFindings(root);
    expect(findings.map((f) => f.flag)).toEqual(['sed -i']);
    expect(findings[0].line).toBe(1);
  });

  it('does not continue a COMMENT — bash ends one at the newline whatever the last character is', () => {
    // Joining here would splice real code onto prose and invent a command nobody wrote.
    const root = fixture({
      'scripts/c.sh': '# a trailing backslash in prose \\\n-i is not a command\n',
    });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  // FUSED short clusters. The regex table matched `command … -TARGET` with an optional leading-flags
  // group, and that group swallowed the whole fused token — so four real idioms were silently clean.
  // The options are walked now. (#1590 review)
  it('sees the target letter inside a fused short cluster', () => {
    const root = fixture({
      'scripts/a.sh': 'grep -iP "x" f\n',
      'scripts/b.sh': 'grep -Pi "x" f\n',
      'scripts/c.sh': "sed -ni '1p' f\n",
      'scripts/d.sh': 'stat -Lc %Y f\n',
      'scripts/e.sh': 'xargs -0r rm\n',
    });
    expect(
      findPortabilityFindings(root)
        .findings.map((f) => f.flag)
        .sort(),
    ).toEqual(['grep -P', 'grep -P', 'sed -i', 'stat -c', 'xargs -r']);
  });

  // The other direction, which is why the cluster is walked rather than searched: a value-taking
  // letter consumes the rest of its cluster, so the `P` here is the PATTERN and not the flag.
  it('does not read a cluster VALUE as the flag', () => {
    const root = fixture({
      'scripts/a.sh': 'grep -eP f\n',
      'scripts/b.sh': "sed -e 'i\\' f\n",
      'scripts/c.sh': 'xargs -I r echo\n',
    });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  // Two divergent commands on ONE logical line. The entry loop broke on the first match, so the
  // second was dropped — a silent miss in the scan that exists to remove them. (#1590 review)
  it('reports EVERY divergent command on a line, not the first', () => {
    const root = fixture({ 'scripts/a.sh': 'sed -i "s/a/b/" f && stat -c %Y f\n' });
    expect(
      findPortabilityFindings(root)
        .findings.map((f) => f.flag)
        .sort(),
    ).toEqual(['sed -i', 'stat -c']);
  });

  // A command position can open without whitespace in front of it. Splitting on whitespace alone
  // left the word as `x=$(sed`, which matched nothing. (#1590 review)
  it('sees a command that opens a substitution or follows a pipe with no space', () => {
    const root = fixture({
      'scripts/a.sh': 'x=$(sed -i "s/a/b/" f)\n',
      'scripts/b.sh': 'x=`stat -c %Y f`\n',
      'scripts/c.sh': 'cat f |sed -i "s/a/b/" g\n',
    });
    expect(
      findPortabilityFindings(root)
        .findings.map((f) => f.flag)
        .sort(),
    ).toEqual(['sed -i', 'sed -i', 'stat -c']);
  });

  // An option belongs to the command it follows, not to any command on the line.
  it('does not attribute a later command’s flag to an earlier one', () => {
    const root = fixture({ 'scripts/a.sh': 'grep x f | sort -f\n' });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  // `#` is the whole of shell comment syntax. The first version also treated `//`, `*` and `/*` as
  // comments — carried over from when this scan read `.mjs` too — and once the scope narrowed to
  // shell they started HIDING code: the default branch of a `case` begins with `*`. A rule that
  // hides real commands is worse than no rule. (#1590 review)
  it('does not mistake a case branch for a comment', () => {
    const root = fixture({
      'scripts/case.sh': 'case "$x" in\n  a) echo a ;;\n  *) sed -i "s/a/b/" f ;;\nesac\n',
      'scripts/star.sh': '  * ) stat -c %Y f ;;\n',
    });
    const { findings } = findPortabilityFindings(root);
    expect(findings.map((f) => `${f.file}:${f.flag}`).sort()).toEqual([
      `${path.join('scripts', 'case.sh')}:sed -i`,
      `${path.join('scripts', 'star.sh')}:stat -c`,
    ]);
  });

  // A TRAILING comment is not code. `isComment` only saw a line that STARTS with `#`, so
  // `cmd args # avoid sed -i here` was scanned in full and reported as a real invocation — a false
  // positive on exactly the documentation this rule asks people to write. (#1590 review)
  it('cuts a trailing comment, and only where a comment actually starts', () => {
    const root = fixture({
      'scripts/a.sh': 'echo hi # avoid sed -i here\n',
      'scripts/b.sh': 'sed -i "s/a/b/" f # in place\n',
      'scripts/c.sh': 'grep -P "#tag" f\n',
      'scripts/d.sh': 'echo a#b\n',
    });
    expect(
      findPortabilityFindings(root)
        .findings.map((f) => `${f.file}:${f.flag}`)
        .sort(),
    ).toEqual([
      `${path.join('scripts', 'b.sh')}:sed -i`,
      `${path.join('scripts', 'c.sh')}:grep -P`,
    ]);
  });

  // A separator GLUED to the previous argument ends the command just as a spaced one does, and a
  // separator INSIDE quotes does not end it at all. Both are the same question — what is code —
  // which is why the quoted spans are neutralised before the split. (#1590 review)
  it('ends the command at a glued separator, but not at a quoted one', () => {
    const root = fixture({
      'scripts/a.sh': 'sed x f;curl -i url\n',
      'scripts/b.sh': 'sed x f|curl -i url\n',
      'scripts/c.sh': "sed 's/a;b/c/' -i f\n",
    });
    expect(findPortabilityFindings(root).findings.map((f) => f.flag)).toEqual(['sed -i']);
  });

  // Escapes, which the quote tracker has to model or it desynchronises. `\"` inside a double-quoted
  // span does NOT close it; reading it as a close made the next real `"` an OPEN and masked the rest
  // of the line as quoted data, swallowing anything in it. A backslash inside SINGLE quotes is a
  // literal — applying the double-quote rule there desynchronises the other way. (#1590 review)
  it('tracks escapes the way the shell does', () => {
    const root = fixture({
      'scripts/a.sh': 'echo "a\\"b" sed -i f\n',
      'scripts/b.sh': "echo 'it\\' sed -i f\n",
      'scripts/c.sh': 'find . -exec echo {} \\; sed -i f\n',
      'scripts/d.sh': 'echo \\# sed -i f\n',
    });
    expect(findPortabilityFindings(root).findings.map((f) => f.flag)).toEqual([
      'sed -i',
      'sed -i',
      'sed -i',
      'sed -i',
    ]);
  });

  // Shell keywords are keywords in COMMAND position only; as an argument they are ordinary words.
  // Ending the walk on one is a silent miss of every flag after it. (#1590 review)
  it('does not end the command at a file named like a shell keyword', () => {
    const root = fixture({ 'scripts/a.sh': 'grep x done -P y\n' });
    expect(findPortabilityFindings(root).findings.map((f) => f.flag)).toEqual(['grep -P']);
  });

  // GNU `stat -f` is `--file-system`, a boolean. Listing it as value-taking stopped the cluster walk
  // at the `f` and missed the real `-c` behind it. (#1590 review)
  it('reads the -c in a fused stat cluster whose other letter takes no value', () => {
    const root = fixture({ 'scripts/a.sh': 'stat -fc %Y f\n' });
    expect(findPortabilityFindings(root).findings.map((f) => f.flag)).toEqual(['stat -c']);
  });

  it('does not flag a COMMENT — prose that discusses a flag does not run it', () => {
    const root = fixture({
      // `#` only — the whole of shell comment syntax, indented or not.
      'scripts/doc.sh': '# sed -i is banned here, use node\n  # readlink -f likewise\nexit 0\n',
    });
    expect(findPortabilityFindings(root).findings).toEqual([]);
  });

  it('excludes test fixture trees, and REPORTS that it did', () => {
    const root = fixture({ 'scripts/__tests__/fx.sh': 'sed -i "s/a/b/" f\n' });
    const { findings, skipped } = findPortabilityFindings(root);
    expect(findings).toEqual([]);
    expect(skipped).toContain(path.join('scripts', '__tests__'));
  });

  it('reports the SIZE of what it examined, so a pass over nothing is visible', () => {
    const root = fixture({ 'scripts/a.sh': 'echo hi\n', 'scripts/b.sh': 'echo ho\n' });
    expect(findPortabilityFindings(root).filesExamined).toBeGreaterThanOrEqual(2);
  });

  // A file that cannot be READ is not a file that is absent. Catching every error and answering
  // "not a shell script" dropped the file out of the scan AND out of `filesExamined`, so the
  // examined-size self-report would have under-counted with no signal. (#1590 review)
  it('REFUSES to decide about a file it could not read', () => {
    const root = fixture({ 'scripts/hook': '#!/bin/sh\nstat -c %Y f\n' });
    const target = path.join(root, 'scripts', 'hook');
    chmodSync(target, 0o000);
    try {
      // Running as root defeats the permission bit; skip rather than assert a false thing.
      let readable = true;
      try {
        readFileSync(target, 'utf8');
      } catch {
        readable = false;
      }
      if (readable) return;
      expect(() => findPortabilityFindings(root)).toThrow(/could not read/);
    } finally {
      chmodSync(target, 0o644);
    }
  });

  it('REFUSES to pass over a tree it cannot read', () => {
    const root = makeTemp('portability-empty-');
    roots.push(root);
    expect(() => findPortabilityFindings(root)).toThrow(/governed tree\(s\) absent/);
  });

  it('the real repository is clean, so this scan is a ratchet and not a backlog', () => {
    const { findings, filesExamined } = findPortabilityFindings(
      path.resolve(import.meta.dirname, '../../..'),
    );
    expect(filesExamined).toBeGreaterThan(20);
    expect(findings).toEqual([]);
  });
});
