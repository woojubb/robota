import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LIB = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/command-scan.sh');

/**
 * The guards read a shell command with regular expressions. Shell quoting is not a regular
 * language — nesting (`$(…)` inside quotes inside `$(…)`) needs a stack, and a regex has none — so
 * every masker is an approximation that holds until someone writes a spelling nobody tried.
 *
 * Measured over four days: `branch-guard.sh` rewritten 26 times, seven distinct instances of this
 * one class, **every one found by a person hitting a new spelling**. Twice the new spelling refused
 * the creation of the branch its own fix lived on.
 *
 * A hand-written case list cannot end that, because the next spelling is by definition not on it.
 * What can is an ORACLE, and there is one sitting right there: bash. Generate the shapes, run each
 * one for real with a recording stub on `PATH`, and ask the shell whether the verb actually ran.
 * Then require the masker's reading to agree.
 *
 * Nothing destructive executes: `git` is a stub that records its argv and exits 0. The commands are
 * about what the SHELL does with the text, not about what git would have done.
 *
 * This is the mechanism INFRA-075 asks for, standing on its own: it needs no new tokenizer, and it
 * fails on a disagreement whatever the cause. A tokenizer, when it lands, is judged by this same
 * corpus.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reading-'));
  scratch.push(dir);
  const bin = path.join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  const log = path.join(dir, 'calls.log');
  // A recorder, not git. It logs the SUBCOMMAND — the first argument that is not a global flag —
  // because `git -C /tmp push` invokes push just as truly as `git push` does, and a recorder that
  // logged the raw argv would call the first token `-C`. Logging the subcommand also means a verb
  // appearing inside a commit MESSAGE is never mistaken for one, which would make the oracle agree
  // with a masker that is wrong.
  const recorder = [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -C|-c|--git-dir|--work-tree|--namespace|--exec-path) shift 2 ;;',
    '    -*) shift ;;',
    `    *) printf '%s\\n' "$1" >> ${JSON.stringify(log)}; exit 0 ;;`,
    '  esac',
    'done',
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(path.join(bin, 'git'), recorder);
  chmodSync(path.join(bin, 'git'), 0o755);
  return { dir, bin, log };
}

/** Did bash actually invoke `git <verb>`? The oracle — real shell semantics, no parser involved. */
function bashRuns(command, verb) {
  const { dir, bin, log } = sandbox();
  spawnSync('bash', ['-c', command], {
    cwd: dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (!existsSync(log)) return false;
  return readFileSync(log, 'utf8')
    .split('\n')
    .some((line) => line.trim() === verb);
}

/**
 * What the shared masker lets a guard see: does the verb survive into the scanned text?
 *
 * The command and the verb arrive as ARGUMENTS, never interpolated into the probe script. An
 * earlier version built the script by substitution, so a corpus entry containing `$(…)` was
 * EXECUTED while being measured — the measurement running the thing it was supposed to be reading.
 * One escape level is the most this can afford, and this is that level.
 */
function maskerSees(command, verb) {
  const probe = [
    'source "$1"',
    'scanned=$(hook_verb_scan "$2")',
    'printf \'%s\' "$scanned" | grep -qE "(^|[;&|({\\"\'\\`]|[[:space:]])[[:space:]]*([^[:space:]]+=[^[:space:]]+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*$3([^-[:alnum:]_]|$)"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', probe, '_', LIB, command, verb], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return result.status === 0;
}

/**
 * The corpus. Every entry is a way of writing a command that a person might plausibly write, and
 * the point of each is a construct the masker has to get right — not a variation on one shape.
 */
const CORPUS = [
  // Plain, and the boundary immediately after the verb — the shape no fixture had.
  'git push',
  'git push;',
  'git push; echo done',
  'git push&',
  'git push|cat',
  '(git push)',
  '{ git push; }',
  // Separators and continuations before it.
  'cd /tmp && git push',
  'cd /tmp \\\n  && git push',
  'true; git push',
  // Assignments and global flags between `git` and the verb.
  'FOO=1 git push',
  'FOO=1 BAR=2 git push',
  'git -C /tmp push',
  'git -c user.name=x push',
  // Quoted MENTIONS — the verb is text, not a command. The masker must hide these.
  "echo 'git push'",
  'echo "git push"',
  "git commit -m 'about to git push later'",
  'git commit -m "about to git push later"',
  '# git push',
  'echo hi # git push',
  // A mention nested inside a substitution. Open until 2026-08-01, when the restore pass learned to
  // keep a quote that opens INSIDE the span; the exemption was removed because this case went green,
  // which is what pinning a disagreement AS a disagreement buys.
  "out=$(echo 'git push'); echo $out",
  // Interpreter strings — the verb really does run, inside another shell.
  'bash -c "git push"',
  "sh -c 'git push'",
  // Escapes.
  'echo \\"git push\\"',
  // A different verb entirely: must not read as a push.
  'git pushd-something',
  'git push-tags-please',
];

/**
 * Known-open disagreements, each naming the item that owns it. An exemption carries a reason and an
 * ID — an unexplained one is how a corpus becomes decorative.
 */
const KNOWN_OPEN = new Map([
  [
    'echo \\"git push\\"',
    'INFRA-075 (same root) — an escaped quote is a literal character, so the verb survives as bare ' +
      'words in an ARGUMENT list. Telling an argument from a command needs command-position ' +
      'tracking, which is the tokenizer that item asks for and not something a mask can do',
  ],
]);

describe("the masker's reading of a command matches what bash does with it", () => {
  it('has a corpus and an oracle', () => {
    // Fail closed: an emptied corpus or a stub that never records would make every case below pass
    // over nothing.
    expect(CORPUS.length).toBeGreaterThan(20);
    expect(bashRuns('git push', 'push'), 'the oracle did not observe an obvious push').toBe(true);
    expect(bashRuns("echo 'git push'", 'push'), 'the oracle saw a push in an echo').toBe(false);
  });

  for (const command of CORPUS) {
    const known = KNOWN_OPEN.get(command);
    it(`${known ? '[known-open] ' : ''}${JSON.stringify(command)}`, () => {
      const actuallyRan = bashRuns(command, 'push');
      const wasSeen = maskerSees(command, 'push');

      if (known) {
        // Pinned as a disagreement, so closing it turns this case red and the exemption gets removed
        // rather than outliving its reason.
        expect(wasSeen, `${known} — if this now agrees, delete the exemption`).not.toBe(
          actuallyRan,
        );
        return;
      }

      expect(
        wasSeen,
        actuallyRan
          ? 'bash RAN git push and the masker did not see it — a guard reading this text is blind ' +
              'to a real invocation, which is a bypass'
          : 'bash did NOT run git push and the masker saw one — a guard reading this text refuses ' +
              'correct work, which is how a guard gets disabled',
      ).toBe(actuallyRan);
    });
  }
});
