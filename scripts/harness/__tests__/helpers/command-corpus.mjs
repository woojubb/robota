/**
 * The differential corpus: ways of writing a shell command that a person might plausibly write.
 *
 * It lived inside `hook-reading-matches-bash.test.mjs`, where exactly one consumer could reach it —
 * and that consumer measured a FUNCTION. #1572 was filed because a corpus that only ever reaches
 * `hook_verb_scan` proves the tokenizer is right and says nothing about whether the guards consult
 * it; two hooks went on reading the weaker string and stayed green through #1565. So the corpus is
 * a module now, and the file that measures the hooks' VERDICTS reads the same shapes as the file
 * that measures the reading.
 *
 * Every entry is here for a CONSTRUCT the reading has to get right, not for a variation on one
 * shape.
 */

export const SQ = String.fromCharCode(39);
export const BT = String.fromCharCode(96);
export const NL = '\n';

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

export const GENERATED = generated();
export const CORPUS = [...new Set([...HANDWRITTEN, ...GENERATED])];
