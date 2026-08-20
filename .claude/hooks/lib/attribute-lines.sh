#!/usr/bin/env bash
#
# INFRA-109 — the batched entry point, so the committed-script scan can use the SAME attribution the
# hook uses instead of re-deriving it in regex.
#
# Reads NUL-separated command lines on stdin and writes `INDEX<TAB>COMMAND` for every hazard row a
# line actually passes to its command. One process for the whole run: the scan has ~160 candidate
# lines in shell files, and a process per line would have cost more than the reading is worth.
#
# fail-direction: refuse. An unreadable table exits non-zero rather than printing nothing, because
# "no hazards found" and "I could not look" must not be the same output — the caller cannot tell them
# apart from an empty stream.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=command-scan.sh
source "$HERE/command-scan.sh"
# shellcheck source=flag-attribution.sh
source "$HERE/flag-attribution.sh"

TABLE="${1:?attribute-lines.sh needs the hazard table path}"
if ! ROWS=$(hazard_rows "$TABLE"); then
  echo "attribute-lines: could not read the hazard table at $TABLE" >&2
  exit 1
fi

INDEX=0
while IFS= read -r -d '' LINE; do
  while IFS= read -r HIT; do
    [[ -n "$HIT" ]] && printf '%s\t%s\n' "$INDEX" "$HIT"
  done < <(attributed_options "$LINE" "$ROWS")
  INDEX=$((INDEX + 1))
done
