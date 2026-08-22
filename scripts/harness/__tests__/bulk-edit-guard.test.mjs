/**
 * INFRA-105 (#1884) — a bulk edit must not be able to reach the pnpm store.
 *
 * The incident this guards against is invisible after the fact: `packages/<a>/node_modules/@scope/<b>`
 * is a symlink to `packages/<b>`, and `node_modules/.pnpm` is hard-linked into every other project on
 * the machine. `git status` cannot see a write that lands there, and every harness scan reads
 * `git ls-files`, which cannot list `node_modules` at all. So the check has to happen BEFORE the write.
 *
 * Every rule is asserted in BOTH directions — the hazardous spelling refused AND its safe sibling
 * permitted. A guard that has only ever been shown to say no is a guard nobody has shown can say yes,
 * and that is the shape that gets switched off the first time it blocks correct work. The sibling
 * halves are not padding: `find` without `-L`, `grep -r`, `rg` without `--follow`, `Path.rglob`,
 * bash `**` under globstar and `fs.globSync` were each MEASURED not to traverse a symlink, which is
 * why the guard aims at four spellings rather than at recursive enumeration in general.
 */

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/bulk-edit-guard.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

function run(payload) {
  const result = spawnSync('bash', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: WORKSPACE_ROOT, BULK_EDIT_ACK: '0' },
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

const bash = (command) => run({ tool_name: 'Bash', tool_input: { command } });

/** The same call with the ack EXPORTED rather than inline — the only form a tool write can take. */
function runAcked(payload) {
  const result = spawnSync('bash', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: WORKSPACE_ROOT, BULK_EDIT_ACK: '1' },
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}
const write = (filePath) => run({ tool_name: 'Write', tool_input: { file_path: filePath } });

describe('a file-writing tool naming the dependency store', () => {
  it('refuses a path with a node_modules segment', () => {
    const { status, stderr } = write(
      'packages/agent-cli/node_modules/@robota-sdk/agent-core/src/x.ts',
    );
    expect(status).toBe(2);
    expect(stderr).toContain('dependency store');
  });

  it('refuses a path inside the .pnpm store', () => {
    expect(write('node_modules/.pnpm/vitest@3.0.0/node_modules/vitest/dist/index.js').status).toBe(
      2,
    );
  });

  it('permits an ordinary workspace source path', () => {
    expect(write('packages/agent-cli/src/remote-control/local-peer-registry.ts').status).toBe(0);
  });

  it.each([
    ['cp', 'cp dist/patched-index.js packages/a/node_modules/.pnpm/lodash@4.17.21/x.js'],
    ['mv', 'mv src/a.ts packages/a/node_modules/b/x.ts'],
    ['rsync', 'rsync -a dist/ packages/a/node_modules/b/'],
    ['install', 'install -m 644 x.js node_modules/pkg/x.js'],
    ['dd', 'dd if=/dev/zero of=node_modules/pkg/x.bin'],
  ])('refuses %s when its DESTINATION is inside the store', (_name, command) => {
    // Reported in review of this change. A redirect and an in-place editor are two ways of writing
    // content; a copy is a third, and it landed in the hard-linked store while matching no rule.
    expect(bash(command).status).toBe(2);
  });

  it.each([
    ['the reinstall idiom', 'rm -rf node_modules && pnpm install'],
    ['moving the store aside', 'mv node_modules /tmp/backup'],
    ['renaming the store', 'mv node_modules node_modules.bak'],
    ['copying OUT of the store', 'cp -r node_modules /tmp/x'],
    ['an ordinary copy', 'cp dist/a.js packages/app/src/a.js'],
    [
      'a directory that only contains the letters',
      'cp dist/a.js packages/app/my_node_modules/a.js',
    ],
  ])('permits %s', (_name, command) => {
    // The copy rule is judged on the DESTINATION for exactly this reason: every one of these READS
    // from the store or writes past it, and refusing them is how a guard earns its ack being pasted.
    expect(bash(command).status).toBe(0);
  });

  it('attributes a flag to an ABSOLUTE-PATH invocation of the same command', () => {
    // Reported in review of this change. `$0 == CMD` was a literal match, so `/usr/bin/find -L …`
    // set nothing and its `-L` was attributed to no command at all — while the committed-script scan,
    // which matches on a word boundary, reported the very same line. Two halves of one rule
    // disagreeing on a bypass is worse than either being wrong alone: the green half is the one a
    // reader trusts. Command words are matched by BASENAME now.
    expect(bash("/usr/bin/find -L packages -name '*.ts'").status).toBe(2);
    expect(bash("/usr/bin/sed -i 's/a/b/' packages/a/node_modules/b/x.ts").status).toBe(2);
    // The safe siblings, spelled the same absolute way, stay permitted.
    expect(bash("/usr/bin/find packages -name '*.ts'").status).toBe(0);
    expect(bash("/usr/bin/sed -i 's/a/b/' src/a.ts").status).toBe(0);
  });

  it('permits a redirect and an edit into a directory that merely CONTAINS the letters', () => {
    // Reported in review of this change: the Bash-side checks matched `node_modules/` as a plain
    // substring while the write-tool path anchored it on a separator, so a directory ENDING in those
    // letters was permitted by one guard and refused by the other — the case both already had a test
    // for, answered two different ways.
    //
    // The name matters. Review's example was `my_node_modules_old/`, which does not contain the
    // substring `node_modules/` at all and was never refused; `my_node_modules/` does, and is. Taking
    // the example on trust would have produced a case that passes whether or not the fix is present —
    // and it did, until the mutation run said so.
    expect(bash('echo x > packages/app/my_node_modules/notes.txt').status).toBe(0);
    expect(bash("sed -i 's/a/b/' packages/app/my_node_modules/x.ts").status).toBe(0);
    // The real store is still refused through both, so anchoring did not simply widen the gate.
    expect(bash('echo x > packages/app/node_modules/notes.txt').status).toBe(2);
    expect(bash("sed -i 's/a/b/' packages/a/node_modules/b/src/x.ts").status).toBe(2);
  });

  it('permits a directory that merely contains the letters', () => {
    // Anchored on separators. `my_node_modules_notes/` is not the store, and a guard that cannot
    // tell them apart refuses documentation about itself.
    expect(write('docs/my_node_modules_notes/why.md').status).toBe(0);
  });

  /** A store directory reachable through a symlink whose own name says nothing. */
  function symlinkedStore() {
    const dir = makeTemp('bulk-edit-guard-');
    scratch.push(dir);
    mkdirSync(path.join(dir, 'node_modules/pkg/src'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules/pkg/src/index.ts'), 'export {};\n');
    mkdirSync(path.join(dir, 'app'), { recursive: true });
    symlinkSync(path.join(dir, 'node_modules/pkg'), path.join(dir, 'app/vendored'));
    return dir;
  }

  it('refuses an EXISTING path that reaches the store only after symlink resolution', () => {
    // The spelled path names nothing suspicious; only resolution shows where the write lands. This
    // is the case a text-only check misses, and it is the exact shape pnpm creates.
    const { status, stderr } = write(path.join(symlinkedStore(), 'app/vendored/src/index.ts'));
    expect(status).toBe(2);
    expect(stderr).toContain('->');
  });

  it('refuses a NEW file inside a symlinked directory', () => {
    // Reported in review of this change, and the sharper half of the finding is about the case
    // above: it pre-created the target, so it proved resolution worked on a path that did not need
    // it. `Write` exists to create files that are not there yet, and the guard tested `-e
    // "$FILE_PATH"` — false for exactly that. The parent directory carries the symlink, and it is
    // there whether or not the file is.
    const { status } = write(path.join(symlinkedStore(), 'app/vendored/src/brand-new.ts'));
    expect(status).toBe(2);
  });

  it('refuses a NEW file inside a NEW subdirectory of a symlinked directory', () => {
    // Reported in review of this change, one level below the case above and the same defect: the
    // parent `app/vendored/newdir` does not exist either, so a test that stops at the parent skips
    // the block again — while the write still lands in the store through `app/vendored`. Some
    // ANCESTOR always exists, which is why the walk cannot recede a third time.
    const { status, stderr } = write(
      path.join(symlinkedStore(), 'app/vendored/newdir/brand-new.ts'),
    );
    expect(status).toBe(2);
    // The reported path carries the unresolved tail, so the operator sees where it actually lands.
    expect(stderr).toContain('newdir/brand-new.ts');
  });

  it('permits a NEW file inside an ordinary directory', () => {
    // The other direction of the same change: moving the existence test to the parent must not make
    // every creation suspicious.
    const dir = makeTemp('bulk-edit-guard-ok-');
    scratch.push(dir);
    mkdirSync(path.join(dir, 'packages/p/src'), { recursive: true });
    expect(write(path.join(dir, 'packages/p/src/brand-new.ts')).status).toBe(0);
  });

  it('permits a NEW file inside a NEW subdirectory of an ordinary directory', () => {
    // The same direction one level deeper. Walking up to an existing ancestor must not turn every
    // mkdir-and-write into a refusal — that is how an ack starts being pasted without being read.
    const dir = makeTemp('bulk-edit-guard-ok-');
    scratch.push(dir);
    mkdirSync(path.join(dir, 'packages/p'), { recursive: true });
    expect(write(path.join(dir, 'packages/p/src/nested/brand-new.ts')).status).toBe(0);
  });
});

describe('the four measured symlink-following enumerators', () => {
  const cases = [
    ['find -L', 'find -L packages -name "*.ts"', 'find packages -name "*.ts"'],
    ['grep -R', 'grep -Rl createSession packages', 'grep -rl createSession packages'],
    ['rg --follow', 'rg --follow -l createSession packages', 'rg -l createSession packages'],
    [
      'python glob.glob',
      'python3 -c "import glob; print(glob.glob(1))"',
      'python3 -c "from pathlib import Path; print(Path(1).rglob(2))"',
    ],
  ];

  it.each(cases)('refuses %s', (_name, hazardous) => {
    expect(bash(hazardous).status).toBe(2);
  });

  it.each(cases)('permits the safe sibling of %s', (_name, _hazardous, safe) => {
    expect(bash(safe).status).toBe(0);
  });

  it('permits grep -L, which is files-without-match and follows nothing', () => {
    // The flag is attributed to the command that RECEIVED it. `-L` after `find` follows symlinks;
    // `-L` after `grep` does not. Reading the flag without its command refused this correct
    // pipeline during development.
    expect(bash('find packages -name "*.ts" | xargs grep -L createSession').status).toBe(0);
  });

  it('still sees a hazardous flag on the first command of a pipeline', () => {
    expect(bash('find -L packages -name "*.ts" | xargs grep -l createSession').status).toBe(2);
  });

  it('sees a command introduced by a wrapper', () => {
    expect(bash('cat list.txt | xargs -0 find -L -name "*.ts"').status).toBe(2);
  });

  it('permits an unrelated command carrying the same letters', () => {
    expect(bash('ls -L packages').status).toBe(0);
  });
});

describe('a content write whose target names the store', () => {
  it('refuses an in-place sed', () => {
    expect(bash('sed -i "s/a/b/" packages/a/node_modules/@robota-sdk/b/src/x.ts').status).toBe(2);
  });

  it('refuses a redirection into the store', () => {
    expect(bash('echo broken > node_modules/.pnpm/pkg/index.js').status).toBe(2);
  });

  it("refuses the noclobber-override redirect, which is the same rule's own subject", () => {
    // `>|` is bash's "write even under noclobber". The rule read `>>?` and then a target, so the
    // `|` fell into the excluded prefix class and the whole spelling walked through.
    expect(bash('echo x >| node_modules/y').status).toBe(2);
    expect(bash('echo x >| /tmp/y').status).toBe(0);
  });

  it('permits the reinstall idioms', () => {
    // `rm -rf node_modules && pnpm install` is what every contributor runs. Refusing it would be a
    // correct command blocked, which is how a guard's ack starts being pasted without being read.
    expect(bash('rm -rf node_modules && pnpm install').status).toBe(0);
    expect(bash('mv node_modules node_modules.bak').status).toBe(0);
  });
});

describe('reading the payload', () => {
  it('refuses an empty payload rather than permitting it', () => {
    // fail-direction. "I could not look" is not "there was nothing there", and permitting here would
    // make a malformed payload the way past the guard.
    const { status, stderr } = run('');
    expect(status).toBe(2);
    expect(stderr).toContain('empty');
  });

  it('refuses a payload that names no tool', () => {
    expect(run({ tool_input: { command: 'echo hi' } }).status).toBe(2);
  });

  it('ignores a tool it does not judge', () => {
    expect(run({ tool_name: 'Read', tool_input: { file_path: 'node_modules/x.js' } }).status).toBe(
      0,
    );
  });
});

describe('the documented escape', () => {
  it('honours the EXPORTED ack on a tool write, which is the only form one can carry', () => {
    // The refusal advertises `BULK_EDIT_ACK=1`, and the tool branch used to exit above the check
    // that reads it — so the escape named in the message could not be taken. A Write carries no
    // command, so there is nowhere to put an inline assignment; the env form is the whole mechanism.
    expect(
      runAcked({ tool_name: 'Write', tool_input: { file_path: 'node_modules/x.js' } }).status,
    ).toBe(0);
    expect(write('node_modules/x.js').status).toBe(2);
  });

  it('refuses an unreadable payload EVEN under the ack, which is the ordering the header asserts', () => {
    // The ack short-circuits the decode refusals inside the tool branch deliberately: it means "I
    // have checked this by hand". It must NOT reach above these two, because neither says WHAT was
    // acked, and a malformed payload would then be the way past the guard.
    expect(runAcked('').status).toBe(2);
    expect(runAcked({ tool_input: { command: 'echo hi' } }).status).toBe(2);
    // THE case the ordering fix actually moved, and the one this file did not have. Both refusals
    // above already stood above the ack in the version being corrected, so they were green either
    // way — a late invariant both versions satisfy. A payload naming a tool whose OWN field cannot
    // be decoded is refused on the integration branch and was permitted by the first cut, which
    // read the ack at the top of the file.
    expect(runAcked({ tool_name: 'Bash', tool_input: {} }).status).toBe(2);
  });

  it("permits Node's fs.glob, which was measured NOT to follow", () => {
    // The widening that looks obvious — matching a bare `glob(` — refuses this.
    expect(bash('node -e "console.log(fs.globSync(1))"').status).toBe(0);
  });

  it('permits an inline BULK_EDIT_ACK=1', () => {
    expect(bash('BULK_EDIT_ACK=1 find -L packages -name "*.ts"').status).toBe(0);
  });

  it('does not accept the ack merely NAMED inside a quoted argument', () => {
    // Read off the masked text, the same rule branch-guard arrived at after four holes. A guard that
    // can be switched off by a string it is scanning is not a guard.
    expect(bash('echo "BULK_EDIT_ACK=1 " && find -L packages -name "*.ts"').status).toBe(2);
  });

  it('does not trip on the four spellings written into a heredoc body', () => {
    // This repository's rule text, task record and the hook's own comments all discuss `find -L`,
    // `grep -R`, `rg --follow` and `glob.glob`. Writing them must not require the ack.
    const doc = 'cat > notes.md <<EOF\navoid find -L, grep -R, rg --follow and glob.glob(...)\nEOF';
    expect(bash(doc).status).toBe(0);
  });
});

describe('what review of this change corrected', () => {
  it('attributes a flag past a wrapper that took its own argument', () => {
    // `sudo -u deploy find -L …` — the walk this replaced promoted `deploy`, a wrapper FLAG'S
    // ARGUMENT, to current command, so `find` was never recognised and its `-L` sailed through.
    // Segment membership needs no list of which wrapper flags take a value.
    expect(bash('sudo -u deploy find -L packages/vendor -name "*.ts"').status).toBe(2);
    expect(bash('nice -n 10 find -L packages -name x').status).toBe(2);
  });

  it('still separates a pipeline, which is what the attribution was for', () => {
    expect(bash('find packages -name "*.ts" | xargs grep -L createSession').status).toBe(0);
  });

  it('requires the editor and the store path in ONE segment', () => {
    // Two independent substring greps over a whole command cannot tell a conjunction from a
    // coincidence: this refused an edit to `src/` that merely stood beside an `ls` of node_modules.
    expect(bash('sed -i "s/a/b/" src/a.ts && ls node_modules/.bin').status).toBe(0);
    expect(bash('sed -i "s/a/b/" packages/a/node_modules/b/src/x.ts').status).toBe(2);
  });
});

describe('what the self-review pass corrected', () => {
  it('judges a redirect on its TARGET, not on the command containing it', () => {
    // Reading FROM the store and writing outside it is ordinary — inspecting an installed package's
    // manifest. The first cut refused this, because it asked only whether a store path appeared
    // anywhere in the command.
    expect(bash('cat node_modules/.pnpm/pkg/package.json > /tmp/out.json').status).toBe(0);
    expect(bash('echo broken > node_modules/.pnpm/pkg/index.js').status).toBe(2);
  });

  it('does not let a leading assignment take the command name slot', () => {
    // `FOO=bar find -L …` — without skipping the assignment it BECAME the current command, and the
    // real one was never judged. This is the same hole in the opposite direction from the ack read.
    expect(bash('FOO=bar find -L packages -name "*.ts"').status).toBe(2);
  });

  it('sees the command after a wrapper that itself takes flags', () => {
    expect(bash('sudo find -L /srv -name "*.ts"').status).toBe(2);
  });
});
