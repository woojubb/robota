#!/usr/bin/env bash
# bulk-edit-guard hook (INFRA-105, #1884)
#
# Refuses a write that can land inside `node_modules` — and the file enumerations that get there.
#
# WHY IT EXISTS. In a pnpm workspace `packages/<a>/node_modules/@scope/<b>` is a SYMLINK to
# `packages/<b>`, and `node_modules/.pnpm` holds content HARD-LINKED into every other project on the
# machine. A bulk edit that enumerates by filesystem pattern therefore reaches both. Measured on this
# workspace while #1884 was being written: a rewrite intended for 857 files was applied across
# 462,643 paths, of which 318,920 resolved into the shared store. Nothing in the repository could
# have reported it — `git status` does not see outside the work tree, and every harness scan reads
# `git ls-files`, which cannot list `node_modules` at all. It was caught because the script happened
# to print what it touched.
#
# fail-direction: refuse — an unreadable payload means this guard does not know what it was asked to
# judge, and a guard whose subject is "a write that nothing downstream can observe" cannot treat "I
# could not look" as "there was nothing there". Permitting on a malformed payload would also make a
# malformed payload the way past it.
#
# WHAT IT AIMS AT, AND WHY THAT IS NARROW. #1884 named `find`, `grep -r`, `rg`, shell `**` under
# globstar and Node's `fs.glob` as equally exposed. Measured, they are not: `find` follows a symlink
# only under `-L`, `grep` only under `-R`, `rg` only under `--follow`, bash and zsh `**` do not
# traverse symlinked directories at all, `fs.globSync` did not, and neither did `pathlib.Path.rglob`.
# The exposure is FOUR spellings, and each has a safe sibling one flag away. That distinction is the
# whole design: a guard aimed at every recursive enumeration would refuse correct commands until
# someone switched it off, and a switched-off guard protects nothing.
#
# STATED LIMIT. A python program fed through a heredoc (`python3 <<'EOF'`) is masked as quoted
# content and is NOT read — the same blindness every guard in this directory has to a heredoc body.
# `python3 -c` IS read, because the library expands interpreter payloads. The scan
# `scan-symlink-following-enumeration.mjs` covers the committed-script side, where a heredoc is
# ordinary file text.

set -uo pipefail

INPUT=$(cat)

# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

if [ -z "${INPUT//[[:space:]]/}" ]; then
  echo "[bulk-edit-guard] Blocked: the hook payload was empty, so nothing was judged." >&2
  exit 2
fi

if ! TOOL_NAME=$(hook_tool_name_of "$INPUT"); then
  echo "[bulk-edit-guard] Blocked: the hook payload names no tool, so nothing can be judged." >&2
  exit 2
fi

# A path segment named exactly `node_modules`, or the store beneath it. Anchored on separators so a
# directory merely CONTAINING the letters (`my_node_modules_notes/`) is not caught.
STORE_SEGMENT_RE='(^|/)(node_modules|\.pnpm)(/|$)'

refuse_path() {
  echo "[bulk-edit-guard] Blocked: this write targets a path inside the dependency store." >&2
  echo "[bulk-edit-guard]   $1" >&2
  echo "[bulk-edit-guard] In a pnpm workspace that path is either a SYMLINK to a real source under" >&2
  echo "[bulk-edit-guard] packages/ — in which case edit the source directly, so the change is one" >&2
  echo "[bulk-edit-guard] edit and git can see it — or content HARD-LINKED into the shared store," >&2
  echo "[bulk-edit-guard] where a write silently changes every project on this machine and survives" >&2
  echo "[bulk-edit-guard] pnpm install." >&2
  echo "[bulk-edit-guard] Deliberate exception: BULK_EDIT_ACK=1 inline in the same command." >&2
  exit 2
}

# --- 1. A file-writing tool naming a store path --------------------------------------------------
if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
  if ! FILE_PATH=$(hook_file_path_of "$INPUT"); then
    echo "[bulk-edit-guard] Blocked: the tool's file path could not be decoded, so it cannot be" >&2
    echo "[bulk-edit-guard] judged. Install jq or python3 so this guard can read what it judges." >&2
    exit 2
  fi
  [[ -n "$FILE_PATH" ]] || exit 0

  if printf '%s' "$FILE_PATH" | grep -qE "$STORE_SEGMENT_RE"; then
    refuse_path "$FILE_PATH"
  fi

  # RESOLVED as well as spelled. A path can reach the store without naming it — `packages/a/nm-link/x`
  # where `nm-link` is a symlink into node_modules.
  #
  # The existence test walks UP to the NEAREST EXISTING ANCESTOR. Review of this change reported the
  # same defect twice, one level apart. The first version tested `-e "$FILE_PATH"`, false for exactly
  # what `Write` exists to do — create a file that is not there yet — so a new file inside a
  # symlinked directory skipped the block entirely. Moving the test to `-d "$PARENT"` fixed that one
  # and left the next depth down: a write into a subdirectory that does not exist YET, under the
  # directory that carries the link. Its parent does not exist either, so the block is skipped again
  # — and the write still lands in the store.
  #
  # An ancestor is what CARRIES the symlink — pnpm links DIRECTORIES — and some ancestor always
  # exists, so that is the level the test belongs at and the level at which it cannot recede again.
  # The unresolved tail is carried along and re-appended, so the reported path is the one asked for.
  #
  # The test that was supposed to cover the first case pre-created its target with `writeFileSync`,
  # so it proved resolution worked on a path that did not need it. That is the more useful half of
  # the finding, and it is why each depth below is now a case of its own.
  #
  # `cd` + `pwd -P` rather than `readlink -f`: the `-f` form is GNU-only and fails unhelpfully on
  # BSD/macOS, which `shell-portability` refuses (see "Host Platform Is Read, Never Assumed"). `pwd
  # -P` is POSIX and resolves the DIRECTORY chain, which is the level pnpm's symlinks live at.
  ANCESTOR=$(dirname -- "$FILE_PATH")
  TAIL=$(basename -- "$FILE_PATH")
  while [[ ! -d "$ANCESTOR" && "$ANCESTOR" != "/" && "$ANCESTOR" != "." ]]; do
    TAIL="$(basename -- "$ANCESTOR")/$TAIL"
    ANCESTOR=$(dirname -- "$ANCESTOR")
  done
  if [[ -d "$ANCESTOR" ]]; then
    RESOLVED=$( (cd "$ANCESTOR" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$TAIL") || printf '')
    if [[ -n "$RESOLVED" ]] && printf '%s' "$RESOLVED" | grep -qE "$STORE_SEGMENT_RE"; then
      refuse_path "$FILE_PATH -> $RESOLVED"
    fi
  fi
  exit 0
fi

[[ "$TOOL_NAME" == "Bash" ]] || exit 0

if ! COMMAND=$(hook_command_of "$INPUT"); then
  echo "[bulk-edit-guard] Blocked: the tool command could not be decoded, so it cannot be judged." >&2
  echo "[bulk-edit-guard] Install jq or python3 so this guard can read what it is judging." >&2
  exit 2
fi

# The masked reading, for the same reason branch-guard and no-foreground-wait use it: a spelling
# merely NAMED inside a quoted argument or a heredoc body is not a spelling that RUNS. This file, the
# rule text and the task record all discuss the four hazardous forms in prose, and none of them may
# trip the guard that reads them.
MASK=$(hook_verb_scan "$COMMAND" 2>/dev/null || printf '%s' "$COMMAND")

if [[ "${BULK_EDIT_ACK:-0}" == "1" ]]; then exit 0; fi
if printf '%s' "$MASK" |
  grep -qE '(^|[;&|]|&&)[[:space:]]*([[:alnum:]_]+=[^[:space:]]+[[:space:]]+)*BULK_EDIT_ACK=1[[:space:]]'; then
  exit 0
fi

# --- The word reading, and the two questions asked of it ------------------------------------------
WORDS=$(hook_statement_all_words "$COMMAND" 2>/dev/null || printf '%s' "$COMMAND")

# Was FLAG passed TO COMMAND — not "does the flag appear anywhere". The difference is a real command
# this guard refused during development: `find packages -name '*.ts' | xargs grep -L foo` carries a
# `-L`, but it belongs to `grep`, where it means files-without-match and follows nothing. Attributing
# it to `find` refuses a correct pipeline, and a guard that does that gets its ack pasted by reflex.
#
# The unit is the SEGMENT — the run of words between two separators (`|`, `;`, `&&`, `||`). A flag is
# attributed to a command when that command's own word stands earlier in the same segment.
#
# This replaces a "current command" walk that tracked which word was the command in progress. Review
# of this change measured its failure: `sudo -u deploy find -L …` promoted `deploy` — a wrapper
# FLAG'S ARGUMENT — to current command, so `find` was never recognised and its `-L` sailed through.
# Fixing that walk means knowing which wrapper flags take a value, which is a list that has to be
# maintained and is wrong the day it falls behind. Segment membership needs no such list.
#
# STATED LIMIT, because it is the price of dropping the walk: a second command inside one segment
# inherits the first one's attribution. `find … -exec grep -L {} \;` is read as `find` carrying `-L`
# and is refused. That is a false positive, and it is the trade taken deliberately — a pipeline is
# the common shape and is still separated, `-exec grep -L` is not, and the ack is one word away.
segments() {
  printf '%s\n' "$WORDS" | awk '
    function is_sep(w) { return w == "|" || w == ";" || w == "&" || w == "&&" || w == "||" || w == "(" || w == ")" }
    is_sep($0) { print "\034"; next }
    { print }'
}

cmd_flag() {
  segments | awk -v CMD="$1" -v FLAG="$2" '
    $0 == "\034" { seen = 0; next }
    seen && $0 ~ /^-/ && $0 ~ FLAG { found = 1 }
    $0 == CMD { seen = 1 }
    END { exit(found ? 0 : 1) }'
}

# An in-place editor and a store path standing in ONE segment. See the note on the rule above for
# what the segment scope is correcting.
segment_has_editor_and_store_path() {
  segments | awk '
    function reset() { editor = 0; store = 0; sed_or_perl = 0 }
    BEGIN { reset() }
    $0 == "\034" { reset(); next }
    $0 == "sed" || $0 == "perl" { sed_or_perl = 1 }
    sed_or_perl && $0 ~ /^-[[:alnum:]]*i/ { editor = 1 }
    $0 == "tee" || $0 == "truncate" { editor = 1 }
    $0 ~ /(node_modules|\.pnpm)\// { store = 1 }
    editor && store { found = 1 }
    END { exit(found ? 0 : 1) }'
}

# --- 2. A content write whose target names the store ---------------------------------------------
# Scoped to CONTENT writes on purpose. `rm -rf node_modules` and `mv node_modules …` are the reinstall
# idioms every contributor runs; refusing them would be a correct command blocked, which is how a
# guard earns its ack being pasted by reflex.
# A REDIRECT is judged on its TARGET, not on the command containing it. `cat node_modules/.pnpm/p/
# package.json > /tmp/out` reads from the store and writes outside it, and the first cut of this
# branch refused it, because it asked only whether the command mentioned a store path anywhere.
if printf '%s' "$MASK" | grep -qE '>>?[[:space:]]*[^[:space:]|;&]*(node_modules|\.pnpm)/'; then
  refuse_path "the command redirects output into node_modules or .pnpm"
fi

# The in-place editors take their targets as ARGUMENTS, so an editor and a store path in the SAME
# SEGMENT is tight — there is no other place the path could be going.
#
# The segment scope is the correction. "An editor anywhere AND a store path anywhere" refused
# `sed -i 's/a/b/' src/a.ts && ls node_modules/.bin`, where the edit and the store path have nothing
# to do with each other: two independent substring greps over one command text cannot tell a
# conjunction from a coincidence. Reported in review of this change.
if segment_has_editor_and_store_path; then
  refuse_path "an in-place editor is given a path naming node_modules or .pnpm"
fi

# --- 3. The four measured symlink-following enumerators ------------------------------------------
# Every finding names the safe sibling as well as the hazard. That half is not decoration: it is what
# makes the refusal actionable in one edit, and a refusal that is not actionable is one that gets
# acked instead of fixed.
FOUND=''
add_finding() { FOUND="${FOUND}[bulk-edit-guard]   $1"$'\n'; }

if cmd_flag find '^(-L|-follow)$'; then
  add_finding "find -L follows symlinks. Drop -L: plain find does not (measured)."
fi
if cmd_flag grep '^(-[[:alnum:]]*R[[:alnum:]]*|--dereference-recursive)$'; then
  add_finding "grep -R dereferences every symlink. Use -r, which does not (measured)."
fi
if cmd_flag rg '^(--follow|-[[:alnum:]]*L[[:alnum:]]*)$' || cmd_flag ripgrep '^(--follow|-[[:alnum:]]*L[[:alnum:]]*)$'; then
  add_finding "rg --follow follows symlinks. Drop it: rg does not follow, and honours .gitignore."
fi
if printf '%s' "$MASK" | grep -qE '\bglob\.(glob|iglob)\('; then
  add_finding "python glob.glob follows symlinks. pathlib Path(...).rglob does not (measured)."
fi

[[ -n "$FOUND" ]] || exit 0

echo "[bulk-edit-guard] Blocked: this command enumerates files by following symlinks, which in a" >&2
echo "[bulk-edit-guard] pnpm workspace reaches node_modules and the store hard-linked beneath it." >&2
printf '%s' "$FOUND" >&2
echo "[bulk-edit-guard] Prefer git ls-files as the source of a bulk edit — it cannot return a" >&2
echo "[bulk-edit-guard] node_modules path at all. See .agents/rules/operational.md." >&2
echo "[bulk-edit-guard] Deliberate exception: BULK_EDIT_ACK=1 inline in the same command." >&2
exit 2
