#!/usr/bin/env bash
#
# INFRA-123 — the batched entry point, so the committed-script scan can name embedded payloads with
# the SAME reader the hook uses instead of guessing a language from a file extension.
#
# Reads NUL-separated documents on stdin and writes `INDEX INTERPRETER START LENGTH` for every
# interpreter payload each one embeds. `START`/`LENGTH` index into that document. One process for the
# whole run, for the reason `attribute-lines.sh` gives: a process per file would cost more than the
# reading is worth.
#
# A document here is a whole FILE, not a line: a payload can span lines, and reading line by line
# would cut every multi-line `-c` argument in half.
#
# fail-direction: refuse. There is no table to read here, but a decode failure still exits non-zero
# rather than printing nothing, because "no payloads" and "I could not look" must not be the same
# output to the caller.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=command-scan.sh
source "$HERE/command-scan.sh"

INDEX=0
while IFS= read -r -d '' DOC; do
  while read -r INTERP START LEN; do
    [[ -n "$INTERP" ]] && printf '%s %s %s %s\n' "$INDEX" "$INTERP" "$START" "$LEN"
  done < <(hook_interpreter_payloads "$DOC")
  INDEX=$((INDEX + 1))
done
