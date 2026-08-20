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
# shellcheck source=lib/flag-attribution.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/flag-attribution.sh"
# shellcheck source=lib/canonical-path.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/canonical-path.sh"

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
  echo "[bulk-edit-guard] Deliberate exception: BULK_EDIT_ACK=1 — inline in the same command, or" >&2
  echo "[bulk-edit-guard] exported, which is the only form a tool write can carry because it runs no" >&2
  echo "[bulk-edit-guard] command to put an assignment in front of. Exported stays armed until unset." >&2
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

  # The env-form ack, read HERE: below this branch's own decode refusal, above its judgement.
  #
  # It has to exist at all because the refusal advertises `BULK_EDIT_ACK=1` and a `Write` carrying it
  # exported was refused anyway — the tool branch exits before the check the Bash branch uses, so the
  # escape named in the message could not be taken by the tool that most needs it. A write carries no
  # command, so the exported form is the only one it can spell.
  #
  # It has to sit HERE rather than at the top of the file, which was the first cut and was measured
  # wrong: above the decode refusals an ack turned an UNREADABLE payload into a permitted one, on a
  # guard whose header declares it fails toward refusal. Every sibling in this directory already
  # reads its ack below its own decode refusal — `check-forbidden-patterns.sh`, `no-foreground-wait`,
  # `merge-gate` — and the ack means "I checked this write by hand", which is not a claim anyone can
  # make about a payload nothing could read.
  if [[ "${BULK_EDIT_ACK:-0}" == "1" ]]; then exit 0; fi

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
  # WHERE IT LANDS is asked of `canonical-path.sh`, which has a stated domain (INFRA-110). The climb
  # that stood here was hand-rolled canonicalization with none, and three review rounds each found a
  # new input class it got wrong.
  #
  # Two were still live when it was replaced. Measured on a sandbox holding two links into the same
  # vendored package — a DIRECTORY link, which is what pnpm creates, and a FILE link beside it:
  #
  #   the file link                 PERMITTED — the FINAL component was never resolved, so a
  #                                 symlinked FILE into the store passed while the sibling symlinked
  #                                 DIRECTORY was refused
  #   a `..` after a missing        PERMITTED — it was re-attached verbatim and never normalised, so
  #   segment                       the write walked back out of the missing directory and into the
  #                                 store unseen
  #
  # and a third only for a RELATIVE path: `cd` consults `CDPATH` for a relative operand, so an
  # exported `CDPATH` selected a different directory AND printed it to stdout, making `RESOLVED` two
  # newline-separated paths. A fail-OPEN, against the refuse direction this file declares. The item
  # that filed it did not have the relative/absolute distinction; measuring it added that.
  #
  # A path is made absolute against the PAYLOAD's `cwd`, not the directory this hook happens to run
  # in. Those are not the same directory, and resolving against the wrong one is a wrong answer that
  # looks like a right one.
  #
  # An unresolvable path — relative with no usable base, or a symlink loop — is a REFUSAL. "Could not
  # resolve" and "resolved to somewhere safe" must not be the same outcome, which is the fail
  # direction stated in this file's header.
  PAYLOAD_CWD=$(hook_cwd_of "$INPUT" 2>/dev/null || printf '')
  [[ "$PAYLOAD_CWD" == /* ]] || PAYLOAD_CWD="${CLAUDE_PROJECT_DIR:-$PWD}"

  if ! RESOLVED=$(canonical_path_from "$PAYLOAD_CWD" "$FILE_PATH"); then
    echo "[bulk-edit-guard] Blocked: could not resolve where '$FILE_PATH' lands (relative with no" >&2
    echo "[bulk-edit-guard] usable base, or a symlink loop), so it was not judged." >&2
    exit 2
  fi

  if printf '%s' "$RESOLVED" | grep -qE "$STORE_SEGMENT_RE"; then
    refuse_path "$FILE_PATH -> $RESOLVED"
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

# The same env-form ack, below this branch's decode refusal for the same reason.
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
# INFRA-109 discharged the containment note that stood here. Segmentation, option walking and the
# hazard list are all in `lib/flag-attribution.sh` and `scan-symlink-following-enumeration.mjs` reads
# the same table, so the two halves of one rule can no longer be corrected separately. Two of this
# file's own defects went with it: a NEWLINE now separates, because the segments come from
# `hook_statement_ranges` instead of a private walk that never received the token; and the
# in-place-editor rule below no longer hand-rolls a second attribution, so `sed --in-place` is
# recognised wherever `sed -i` is.

# A statement's words, computed once. Every rule below reads THIS, so there is one segmentation.
SEGMENTS=$(hook_statement_segments "$COMMAND" 2>/dev/null || printf '%s' "$WORDS")
segments() { printf '%s\n' "$SEGMENTS"; }

# The store name as a PATH SEGMENT, for the awk-side rules. Same anchoring as `STORE_SEGMENT_RE`,
# spelled for awk because a shell variable does not reach inside the program text.
STORE_IN_AWK='function is_store(w) { return w ~ /(^|\/)(node_modules|\.pnpm)(\/|$)/ }'

# A copying command whose DESTINATION names the store. `dd` states its destination as `of=`; the rest
# take it as the last non-flag word, so the SOURCE may be anywhere, including inside the store.
segment_copies_into_store() {
  segments | awk "$HOOK_ATTRIBUTION_AWK $STORE_IN_AWK"'
    function reset() { copier = 0; dest = "" }
    function flush() { if (copier && dest != "" && is_store(dest)) found = 1; reset() }
    BEGIN { reset() }
    $0 == "\034" { flush(); next }
    base($0) == "cp" || base($0) == "mv" || base($0) == "rsync" || base($0) == "install" || base($0) == "dd" { copier = 1; next }
    copier && $0 ~ /^of=/ { d = $0; sub(/^of=/, "", d); if (is_store(d)) found = 1; next }
    copier && $0 !~ /^-/ { dest = $0 }
    END { flush(); exit(found ? 0 : 1) }'
}

# An in-place editor and a store path standing in ONE segment. See the note on the rule above for
# what the segment scope is correcting.
# The in-place flag is walked as an OPTION through the shared `has_option`, not matched as a pattern.
# It used to be `/^-[[:alnum:]]*i/`, which recognised `-i` and `-ni` and NOT `--in-place` — so
# `sed --in-place s/a/b/ node_modules/x` was permitted while `sed -i` on the same path was refused.
# `perl -i` has no long form; `sed` has both, and the row states both. (INFRA-109 TC-5)
segment_has_editor_and_store_path() {
  segments | awk "$HOOK_ATTRIBUTION_AWK $STORE_IN_AWK"'
    function reset() { editor = 0; store = 0; sed_or_perl = 0 }
    BEGIN { reset() }
    $0 == "\034" { reset(); next }
    base($0) == "sed" || base($0) == "perl" { sed_or_perl = 1 }
    sed_or_perl && has_option($0, "i", "--in-place") { editor = 1 }
    base($0) == "tee" || base($0) == "truncate" { editor = 1 }
    # `is_store`, the same anchored predicate the copy and write rules use, rather than a second
    # spelling of the name in this rule alone. One guard contradicting itself about what the store IS
    # was already fixed once here, for `my_node_modules_old/`.
    #
    # NOTE: this awk program is a single-quoted shell string, so an apostrophe in a comment CLOSES
    # it and the file then fails to source at all. The note on the words branch in command-scan.sh
    # says so, and this comment was written with one anyway. Write around them.
    is_store($0) { store = 1 }
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
#
# The store name is anchored on a SEPARATOR, the same way `STORE_SEGMENT_RE` anchors it for the write
# tools. Without that, `my_node_modules_old/` — a directory that merely contains the letters — was
# refused here while the write path permitted it, so one guard contradicted the other on the case both
# had a test for. Reported in review of this change.
#
# INFRA-111 closed the containment note that stood here. The rule used to be a regex over redirection
# spellings, and the `>&` family walked straight through it: `>& node_modules/y`, `>&x` and `>&"x"`
# were permitted while `>`, `>>`, `>|`, `&>` and `2>` were refused. That was the third cut of one
# regex, and the second cut's commit had claimed `>|` was "the only miss across eight probed
# spellings". `hook_redirect_targets` now answers it from the tokenizer that already had to parse
# redirections to keep an `&` from splitting a statement, so a spelling added to the grammar reaches
# this rule and `branch-guard.sh` at once instead of being enumerated twice.
while IFS= read -r target; do
  [[ -z "$target" ]] && continue
  if printf '%s' "$target" | grep -qE "$STORE_SEGMENT_RE"; then
    refuse_path "the command redirects output into node_modules or .pnpm"
  fi
done < <(hook_redirect_targets "$COMMAND")

# The in-place editors take their targets as ARGUMENTS, so an editor and a store path in the SAME
# SEGMENT is tight — there is no other place the path could be going. Anchored on a separator for the
# same reason as the redirect above.
#
# The segment scope is the correction. "An editor anywhere AND a store path anywhere" refused
# `sed -i 's/a/b/' src/a.ts && ls node_modules/.bin`, where the edit and the store path have nothing
# to do with each other: two independent substring greps over one command text cannot tell a
# conjunction from a coincidence. Reported in review of this change.
if segment_has_editor_and_store_path; then
  refuse_path "an in-place editor is given a path naming node_modules or .pnpm"
fi

# A COPY whose destination is inside the store. Reported in review of this change: the redirect and
# in-place-editor rules cover two ways of writing content, and `cp`, single-file `mv`, `rsync`,
# `install` and `dd` are a third — `cp dist/patched.js …/node_modules/lodash/index.js` lands in the
# hard-linked store exactly as this file's rationale describes, and matched nothing.
#
# Judged on the DESTINATION, like the redirect. That is what keeps the reinstall idioms working:
# `mv node_modules /tmp/backup` and `cp -r node_modules /tmp/x` READ from the store and write outside
# it, so they pass; `mv node_modules node_modules.bak` passes because the name is anchored on a
# separator. Only a write INTO the store is refused.
if segment_copies_into_store; then
  refuse_path "a copy's destination is inside node_modules or .pnpm"
fi

# --- 3. The four measured symlink-following enumerators ------------------------------------------
# Every finding names the safe sibling as well as the hazard. That half is not decoration: it is what
# makes the refusal actionable in one edit, and a refusal that is not actionable is one that gets
# acked instead of fixed.
FOUND=''
add_finding() { FOUND="${FOUND}[bulk-edit-guard]   $1"$'\n'; }

# The rows come from the table the scan also reads, so a fifth spelling is ONE edit and lands in both
# enforcers at once. A table this guard cannot read is a refusal, not an empty list — see the fail
# direction in this file's header.
HAZARD_TABLE="$(dirname "${BASH_SOURCE[0]}")/../../scripts/harness/symlink-following-hazards.tsv"
if ! HAZARD_ROWS=$(hazard_rows "$HAZARD_TABLE"); then
  echo "[bulk-edit-guard] Blocked: could not read the hazard table at $HAZARD_TABLE, so nothing was judged." >&2
  exit 2
fi

while IFS=$'\t' read -r HZ_ID HZ_CMD HZ_SHORT HZ_LONG HZ_REMEDY; do
  [[ -z "$HZ_CMD" ]] && continue
  if attributed_option "$COMMAND" "$HZ_CMD" "$HZ_SHORT" "$HZ_LONG"; then
    add_finding "$HZ_ID follows symlinks. $HZ_REMEDY"
  fi
done <<< "$HAZARD_ROWS"

# `ripgrep` is the same program under its other installed name, and carries no row of its own —
# a row per alias would put the same hazard in the table twice.
if attributed_option "$COMMAND" ripgrep L --follow; then
  add_finding "rg --follow follows symlinks. drop --follow; rg does not follow, and honours .gitignore"
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
