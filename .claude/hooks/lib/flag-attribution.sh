# shellcheck shell=bash
#
# INFRA-109 — one implementation of "was this hazardous option passed to THIS command, in THIS
# statement", and one list of the spellings, for both enforcers.
#
# WHY. `bulk-edit-guard.sh` and `scan-symlink-following-enumeration.mjs` are the two halves of one
# rule — the hook judges a command as it is about to run, the scan judges the same spelling once it
# has become a committed file. Both answered that question with their own code, and only the hook's
# was ever corrected. Measured divergences at the time this was written:
#
#   sed --in-place … node_modules/x    hook PERMITTED   (the in-place rule read only the short flag)
#   two statements on two LINES        hook REFUSED     (a newline did not separate, so they merged)
#
# The second is the worse direction: it refuses correct work, which is how a guard earns its ack
# being pasted by reflex.
#
# WHAT WAS WRONG WITH THE HOOK'S OWN HALF, and why this is not simply promoted from it:
#
#   * A NEWLINE did not separate. `hook_statement_all_words` emits `&&`, `|` and `;` as words and
#     drops the line break, so a private `is_sep` over those words could never see one. Adding "\n"
#     to that list is inert — the token never arrives. `hook_statement_ranges` already splits
#     correctly, and that is the reader the segmentation is built on here.
#   * The in-place-editor rule hand-rolled a SECOND attribution beside `cmd_flag`, and recognised
#     only `-i`. Both now go through `attributed_option`.
#
# THE UNIT IS THE STATEMENT, not a hand-written bound on what may stand between a command and its
# flag. The scan had four rules with three different such bounds — `(?:-[^\s-][^\s]*\s+)*`,
# `(?:-[a-z][a-z]*\s+)*` and a lazy unbounded `(?:[^\s]+\s+)*?` that crossed `|`, `;` and `&&` alike
# — which is what guaranteed a fifth ad-hoc bound the next time a spelling was added. There is no
# bound to invent here: a statement ends where the shell says it ends.
#
# STATED LIMIT, carried over deliberately: a second command inside one statement inherits the first
# one's attribution, so `find … -exec grep -L {} \;` reads as `find` carrying `-L` and is refused.
# That is a false positive and it is the trade — a pipeline is the common shape and IS separated,
# `-exec grep -L` is not, and the ack is one word away. The alternative is a walk that tracks which
# word is the command in progress, which needs a list of which wrapper flags take a value:
# `sudo -u deploy find -L …` promoted `deploy` to current command and let the `-L` sail through.

# The awk half, shared by every rule that asks about an option. Concatenated ahead of a program.
#
# `has_option` walks OPTIONS rather than matching a pattern, which is what lets a long form be
# recognised wherever its short form is. A short letter is looked for inside a CLUSTER (`grep -nR`
# carries `R`), and a long form is compared whole or up to its `=`. The two dash spellings are not
# interchangeable and each row states its own: find spells it `-follow`, rg spells it `--follow`.
HOOK_ATTRIBUTION_AWK='
  function base(w) { sub(/^.*\//, "", w); return w }

  function has_option(w, short, longs,   n, i, a) {
    if (longs != "-" && longs != "") {
      n = split(longs, a, ",")
      for (i = 1; i <= n; i++) {
        if (w == a[i]) { return 1 }
        if (index(w, a[i] "=") == 1) { return 1 }
      }
    }
    if (short != "-" && short != "" && w ~ /^-[^-]/ && index(substr(w, 2), short) > 0) { return 1 }
    return 0
  }
'

# The statements of a command, each as a \034-separated run of words.
#
# Built on `hook_statement_ranges` — the library reader — rather than on a private walk over
# `hook_statement_all_words`, which is what dropped the newline. `allwords` is the right per-statement
# reading here for the same reason the library gives: a substitution RUNS, so an enumeration inside
# one is as real as a leading one.
hook_statement_segments() {
  local command="$1" start len
  while read -r start len; do
    [[ -z "$start" ]] && continue
    hook_statement_all_words "$command" "$start" "$len"
    printf '\034\n'
  done < <(hook_statement_ranges "$command")
}

# Was an option passed to a command, in one statement?
#
#   $1 command text   $2 command basename   $3 short letter or `-`   $4 long spellings or `-`
#
# Exit 0 when it was. The command's own word must stand EARLIER in the same statement, which is what
# keeps `find packages -name '*.ts' | xargs grep -L foo` permitted: the `-L` belongs to `grep`, where
# it means files-without-match and follows nothing.
attributed_option() {
  attributed_options "$1" "$(printf '%s\t%s\t%s\t%s\t' "$2" "$2" "$3" "$4")" | grep -qxF "$2"
}

# Every hazard in a table that a command actually receives, one command name per line.
#
# ONE awk pass over the whole table rather than one pass per row. The rows are independent, and the
# committed-script scan asks this of every candidate line in the repository — a pass per row made the
# cost proportional to the size of the list, which is a reason not to add a spelling.
#
#   $1 command text
#   $2 rows, `command<TAB>short<TAB>long<TAB>...` per line, as `hazard_rows` prints them
attributed_options() {
  hook_statement_segments "$1" | awk -v ROWS="$2" "$HOOK_ATTRIBUTION_AWK"'
    BEGIN {
      nr = split(ROWS, lines, "\n")
      for (i = 1; i <= nr; i++) {
        if (lines[i] == "") { continue }
        split(lines[i], f, "\t")
        # Fields are `id<TAB>command<TAB>short<TAB>long<TAB>remedy`. The id is what a finding is
        # REPORTED under and is not derived from the columns beside it — `rg` is known by its long
        # form and `find` by its short one.
        id[i] = f[1]; cmd[i] = f[2]; sh[i] = f[3]; lg[i] = f[4]
      }
    }
    $0 == "\034" { for (i = 1; i <= nr; i++) { seen[i] = 0 } ; next }
    {
      # The option is tested BEFORE the command word is marked seen, so a flag standing in front of
      # its own command does not count. Then the word is checked as a command name, so the next word
      # can be attributed to it.
      for (i = 1; i <= nr; i++) {
        if (cmd[i] != "" && seen[i] && has_option($0, sh[i], lg[i])) { found[i] = 1 }
      }
      for (i = 1; i <= nr; i++) {
        if (cmd[i] != "" && base($0) == cmd[i]) { seen[i] = 1 }
      }
    }
    END { for (i = 1; i <= nr; i++) { if (found[i]) { print id[i] } } }'
}

# The shared hazard table, one row per line as `command<TAB>short<TAB>long<TAB>remedy`.
# Comments, the header row and blank lines are dropped, so both readers see the same rows.
hazard_rows() {
  local table="${1:?hazard_rows needs the table path}"
  if [[ ! -r "$table" ]]; then
    # A guard that cannot read its own list must not report "nothing hazardous here". Callers treat
    # a non-zero exit as a refusal, the same direction the rest of this directory takes.
    return 1
  fi
  awk -F'\t' '!/^#/ && NF >= 5 && $1 != "id" && $1 != "" { print }' "$table"
}
