import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LIB = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/command-scan.sh');

/**
 * The guards read a shell command to decide what it will run. Shell quoting is not a regular
 * language — nesting (`$(…)` inside quotes inside `$(…)`) needs a stack — so every masker built out
 * of linear passes is an approximation that holds until someone writes a spelling nobody tried.
 *
 * Measured over four days: `branch-guard.sh` rewritten 26 times, seven distinct instances of this
 * one class, **every one found by a person hitting a new spelling**. Twice the new spelling refused
 * the creation of the branch its own fix lived on.
 *
 * A hand-written case list cannot end that, because the next spelling is by definition not on it.
 * What can is an ORACLE, and there is one sitting right there: bash. Generate the shapes, run each
 * one for real with a recording stub on `PATH`, and ask the shell whether the verb actually ran.
 * Then require the reading to agree.
 *
 * Nothing destructive executes: `git` is a stub that records its argv and exits 0. The commands are
 * about what the SHELL does with the text, not about what git would have done.
 *
 * THE THRESHOLD IS STATED BEFORE THE READING IS BUILT, and it is not a percentage to be negotiated
 * afterwards: every disagreement must be listed in `KNOWN_OPEN` with the item that owns it, and the
 * rate must clear `MIN_AGREEMENT`. A case the reading gets wrong is a bug in the reading, not an
 * exception to add — an entry may only be added here when the shape cannot be read at all by the
 * grammar the tokenizer models, and the entry has to say why.
 */
const MIN_AGREEMENT = 0.98;

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

// Both readings are memoised so the summary case at the end can restate the whole corpus without
// running it a second time. Two process spawns per shape is the cost of using a real shell as the
// oracle; paying it twice would be the cost of not caching.
const ranCache = new Map();
const seenCache = new Map();

/** Did bash actually invoke `git <verb>`? The oracle — real shell semantics, no parser involved. */
function bashRuns(command, verb) {
  const key = JSON.stringify([verb, command]);
  if (ranCache.has(key)) return ranCache.get(key);
  const { dir, bin, log } = sandbox();
  spawnSync('bash', ['-c', command], {
    cwd: dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const answer = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .some((line) => line.trim() === verb)
    : false;
  ranCache.set(key, answer);
  return answer;
}

/**
 * What the shared reading lets a guard see: does the verb survive into the scanned text?
 *
 * The command and the verb arrive as ARGUMENTS, never interpolated into the probe script. An
 * earlier version built the script by substitution, so a corpus entry containing `$(…)` was
 * EXECUTED while being measured — the measurement running the thing it was supposed to be reading.
 * One escape level is the most this can afford, and this is that level.
 */
function maskerSees(command, verb) {
  const key = JSON.stringify([verb, command]);
  if (seenCache.has(key)) return seenCache.get(key);
  const probe = [
    'source "$1"',
    'scanned=$(hook_verb_scan "$2")',
    'printf \'%s\' "$scanned" | grep -qE "(^|[;&|({\\"\'\\`]|[[:space:]])[[:space:]]*([^[:space:]]+=[^[:space:]]+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*$3([^-[:alnum:]_]|$)"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', probe, '_', LIB, command, verb], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const answer = result.status === 0;
  seenCache.set(key, answer);
  return answer;
}

const SQ = String.fromCharCode(39);
const BT = String.fromCharCode(96);
const NL = '\n';

/**
 * Hand-written shapes. Every entry is a way of writing a command that a person might plausibly
 * write, and the point of each is a CONSTRUCT the reading has to get right — not a variation on one
 * shape.
 */
const HANDWRITTEN = [
  // -- plain invocations, and the boundary immediately after the verb --
  'git push',
  'git push;',
  'git push; echo done',
  'git push&',
  'git push|cat',
  '(git push)',
  '{ git push; }',
  'if true; then git push; fi',
  'for i in 1; do git push; done',
  'case x in x) git push;; esac',
  // -- separators, assignments, global flags --
  'cd /tmp && git push',
  'cd /tmp \\\n  && git push',
  'true; git push',
  'FOO=1 git push',
  'FOO=1 BAR=2 git push',
  'git -C /tmp push',
  'git -c user.name=x push',
  // -- a backslash-newline joins two physical lines into one command --
  'git \\\n  push',
  'git push \\\n  origin main',
  // -- quoted mentions: text, not commands --
  `echo ${SQ}git push${SQ}`,
  'echo "git push"',
  `git commit -m ${SQ}about to git push later${SQ}`,
  'git commit -m "about to git push later"',
  `printf ${SQ}%s${SQ} ${SQ}git push${SQ}`,
  'grep -r "git push" /dev/null',
  // -- comments --
  '# git push',
  'echo hi # git push',
  'echo hi #git push',
  'echo "a" # git push',
  'echo "# git push"',
  `echo ${SQ}a # b${SQ} ; git push`,
  `echo $(echo hi # comment${NL}) ; echo done`,
  `x=$(echo hi # git push${NL}); echo done`,
  `echo ok # a half-open remark ${SQ}${NL}git push`,
  // -- the INFRA-075 reproduction, verbatim, and its family --
  `out=$(printf ${SQ}x git push -m y${SQ} | bash h.sh); echo done`,
  `out=$(echo ${SQ}git push${SQ}); echo $out`,
  'out=$(printf "x git push -m y"); echo done',
  // -- substitutions that really do run, at depth --
  'a=$(git push)',
  'a=$(echo "$(git push)")',
  'a=$(echo "$(echo "$(git push)")")',
  `a=$(echo "$(printf ${SQ}git push${SQ})")`,
  `echo "$(echo ${SQ}git push${SQ}) done"`,
  `echo "$(echo ${SQ}safe${SQ}) git push"`,
  // -- backticks --
  `x=${BT}git push${BT}`,
  `x=${BT}echo ${SQ}git push${SQ}${BT}`,
  `echo "${BT}echo ${SQ}git push${SQ}${BT}"`,
  `x=${BT}echo "$(printf ${SQ}git push${SQ})"${BT}`,
  // -- interpreter strings: shell-family ones are read as shell, the rest are read whole --
  'bash -c "git push"',
  `sh -c ${SQ}git push${SQ}`,
  'bash -x -c "git push"',
  '/bin/bash -c "git push"',
  `bash -c "echo ${SQ}git push${SQ}"`,
  `bash -c ${SQ}echo "git push"${SQ}`,
  `bash -c "printf ${SQ}%s\\n${SQ} ${SQ}git push${SQ}"`,
  'eval "git push"',
  `python3 -c ${SQ}print(1)${SQ} "git push is a mention"`,
  // -- ANSI-C and locale quoting --
  `echo $${SQ}git push${SQ}`,
  `echo $${SQ}a\\tgit push${SQ}`,
  `printf $${SQ}x\\${SQ}y git push${SQ}`,
  'echo $"git push"',
  // -- escapes --
  'echo \\"git push\\"',
  'echo "he said \\"git push\\" ok"',
  'echo "\\$(git push)"',
  `echo ${SQ}\\${SQ} ; echo ${SQ}git push${SQ}`,
  `git commit -m "use \\${BT}git push\\${BT} here" 2>/dev/null || true`,
  // -- heredocs --
  `cat <<EOF${NL}git push${NL}EOF`,
  `cat <<${SQ}EOF${SQ}${NL}git push${NL}EOF`,
  `cat <<EOF${NL}$(git push)${NL}EOF`,
  `cat <<${SQ}EOF${SQ}${NL}$(git push)${NL}EOF`,
  `cat <<EOF${NL}text${NL}EOF${NL}git push`,
  `cat <<-EOF${NL}\tgit push${NL}\tEOF`,
  `cat <<EOF${NL}a ${SQ}git push${SQ} b${NL}EOF`,
  `cat <<EOF${NL}$(echo "$(git push)")${NL}EOF`,
  `cat <<A${NL}git push${NL}A${NL}cat <<B${NL}text${NL}B${NL}git push`,
  `cat <<EOF${NL}text${NL}  EOF${NL}git push${NL}EOF`,
  // -- herestrings: no body, no terminator, and an operand that is an ordinary word --
  `cat <<< ${SQ}git push${SQ}`,
  'cat <<< "$(git push)"',
  'cat <<< "git push"',
  // -- redirections and process substitution --
  'echo x > /dev/null; git push',
  'echo x 2>&1 | cat; git push',
  `cat <(echo ${SQ}git push${SQ})`,
  'cat <(git push)',
  `echo ${SQ}a>b${SQ} ; echo ${SQ}git push${SQ}`,
  // -- parameter expansion --
  'echo ${HOME:-git push}',
  'echo ${UNSET_VAR_X:-$(git push)}',
  'echo "${UNSET_VAR_X:-$(git push)}"',
  `echo \${#HOME} ; echo ${SQ}git push${SQ}`,
  // -- arithmetic, including the left shift that looks like a heredoc opener --
  `echo $(( 1 + 1 )) ; echo ${SQ}git push${SQ}`,
  'echo $(( 1 + 1 )) ; git push',
  'echo $(( 2 << 1 )) ; git push',
  // -- arithmetic NESTED IN arithmetic, which the corpus had no shape for. Reached three ways,
  // because a context that reads its own nesting wrong reads it wrong however it was entered.
  'echo $(( $((1+2)) + 1 ))',
  'echo $(( $(( git push )) ))',
  'echo "$(( $(( git push )) ))"',
  `cat <<EOF${NL}$(( $(( git push )) ))${NL}EOF`,
  'echo $(( $(( 1 + 2 )) )) ; git push',
  // -- a quoted argument spanning lines --
  `git commit -m "line one${NL}git push${NL}line three" 2>/dev/null || true`,
  // -- quoted single-word tokens are tokens, not payloads --
  'git "push"',
  `git ${SQ}push${SQ}`,
  'git push "--force"',
  `echo ${SQ}push${SQ}`,
  // -- git is not the first word of the command, and still runs --
  'env git push',
  `echo ${SQ}git push${SQ} && git push`,
  // -- argument position: a word the shell never runs as a command --
  'echo git push',
  `eval ${SQ}echo git push${SQ}`,
  // -- a different verb entirely: must not read as a push --
  'git pushd-something',
  'git push-tags-please',
];

/**
 * Generated shapes: a base command wrapped in layers of substitution and quoting, so the corpus
 * reaches nesting depths a hand list never does. This is the half that answers "the next spelling
 * is not on the list" — it enumerates spellings nobody wrote down.
 */
function generated() {
  const bases = [
    'git push',
    `printf ${SQ}x git push y${SQ}`,
    'echo no-verb-here',
    'echo "git push"',
  ];
  const wordOf = [(c) => `$(${c})`, (c) => `${BT}${c}${BT}`];
  const cmdOf = [
    (w) => `v=${w}`,
    (w) => `echo ${w}`,
    (w) => `echo "${w}"`,
    (w) => `printf ${SQ}%s${SQ} ${w}`,
  ];
  const out = [];
  for (const base of bases) {
    for (let depth = 1; depth <= 3; depth++) {
      for (const wrapWord of wordOf) {
        for (const wrapCmd of cmdOf) {
          let cmd = base;
          let usable = true;
          for (let d = 0; d < depth; d++) {
            // Nested backticks need an escaping the shell does not forgive, so only the outermost
            // layer may be one.
            const word = d === depth - 1 ? wrapWord(cmd) : `$(${cmd})`;
            if (word.includes(BT) && cmd.includes(BT)) usable = false;
            cmd = wrapCmd(word);
          }
          if (usable) out.push(cmd);
        }
      }
    }
  }
  return [...new Set(out)];
}

const GENERATED = generated();
const CORPUS = [...new Set([...HANDWRITTEN, ...GENERATED])];

/**
 * Known-open disagreements, each naming the item that owns it. An exemption carries a reason and an
 * ID — an unexplained one is how a corpus becomes decorative.
 */
const ARGUMENT_POSITION =
  'INFRA-075, deliberately unmodelled — the verb is an ARGUMENT the shell never runs as a ' +
  'command. Hiding it means masking every word that is not the first of a simple command, and ' +
  'then `sudo git push`, `xargs git push`, `env git push`, `timeout 5 git push` and every other ' +
  'exec-style wrapper not on some list goes unseen. An unmodelled wrapper is a silent BYPASS; a ' +
  'mention read as a command is a refusal that announces itself. The trade is taken in the ' +
  'direction that fails loudly.';

const KNOWN_OPEN = new Map([
  ['echo git push', ARGUMENT_POSITION],
  [`eval ${SQ}echo git push${SQ}`, ARGUMENT_POSITION],
  [
    'echo \\"git push\\"',
    `${ARGUMENT_POSITION} Here the escaped quotes leave the verb as two bare words in an argument ` +
      'list, which is the same problem wearing a different spelling.',
  ],
]);

describe('the reading of a command matches what bash does with it', () => {
  it('has a corpus and an oracle', () => {
    // Fail closed: an emptied corpus or a stub that never records would make every case below pass
    // over nothing.
    expect(CORPUS.length).toBeGreaterThan(150);
    expect(GENERATED.length).toBeGreaterThan(50);
    expect(bashRuns('git push', 'push'), 'the oracle did not observe an obvious push').toBe(true);
    expect(bashRuns(`echo ${SQ}git push${SQ}`, 'push'), 'the oracle saw a push in an echo').toBe(
      false,
    );
  });

  it('pins every exemption to a shape the corpus actually contains', () => {
    // An exemption for a shape nobody tests is an exemption that can never be retired.
    for (const command of KNOWN_OPEN.keys()) {
      expect(CORPUS, `exempted shape is not in the corpus: ${JSON.stringify(command)}`).toContain(
        command,
      );
    }
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
          ? 'bash RAN git push and the reading did not see it — a guard reading this text is blind ' +
              'to a real invocation, which is a bypass'
          : 'bash did NOT run git push and the reading saw one — a guard reading this text refuses ' +
              'correct work, which is how a guard gets disabled',
      ).toBe(actuallyRan);
    });
  }

  it(`agrees with bash on at least ${Math.round(MIN_AGREEMENT * 100)}% of the corpus`, () => {
    // The rate is a floor under the whole corpus, not a per-case verdict, so a future change cannot
    // trade a batch of new disagreements for one new exemption and still look green. Both readings
    // are memoised above, so this restates the measurement rather than repeating it.
    const disagreements = CORPUS.filter(
      (command) => bashRuns(command, 'push') !== maskerSees(command, 'push'),
    );
    const rate = (CORPUS.length - disagreements.length) / CORPUS.length;
    expect(
      rate,
      `${disagreements.length} of ${CORPUS.length} shapes disagree with bash:\n` +
        disagreements.map((c) => `  ${JSON.stringify(c)}`).join('\n'),
    ).toBeGreaterThanOrEqual(MIN_AGREEMENT);
    expect(
      disagreements.sort(),
      'every disagreement must be a listed known-open shape',
    ).toStrictEqual([...KNOWN_OPEN.keys()].sort());
  });
});
