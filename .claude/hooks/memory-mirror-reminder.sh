#!/usr/bin/env bash
# Memory Mirroring rule (.agents/rules/memory-mirroring.md) — cross-boundary half.
#
# The repo-side invariant is mechanized by scripts/harness/scan-memory-mirror.mjs.
# This PostToolUse hook catches the trigger a repo scan cannot see: a write to an
# agent's session/host memory (outside the repo) that must ALSO be mirrored into the
# in-repo .agents/memory/. It reminds loudly; it does not block (the write already
# happened, and session memory is external).
#
# Two arms, one rule (issue #2271):
#   Write/Edit/MultiEdit — the payload carries `tool_input.file_path`; that path is judged.
#   Bash — the payload carries `tool_input.command` and no path. Six durable lessons sat
#     unmirrored in one session's host memory because every one was written through a Bash
#     heredoc, which the Write/Edit arm never sees. This arm reads the command text for a
#     write whose target looks like host memory. IT IS A HEURISTIC, and says so: it sees a
#     redirect (`>`/`>>`) into such a path, and a writer verb (`tee`, `cp`, `mv`, `sed`,
#     `install`, `rsync`, `truncate`, `dd`, or an interpreter such as `python3`/`node`/`perl`/
#     `ruby`) with such a path anywhere in the command. A write spelled some other way passes
#     in silence — the set of ways to write a file grows without this file, and the move that
#     closes the class is a session-boundary diff of the two memory directories, not a longer
#     verb list.
#
# A path looks like host/session agent memory when it is …/.claude/…/memory/….md,
# …/.gstack/…/memory/….md or …/.claude/…memory….md, and is NOT the repo mirror.

set -euo pipefail

# One reader for the payload's fields, not one per hook. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && exit 0

# In-repo mirror writes are the compliant case — never remind on those.
is_host_memory_path() {
  case "$1" in
    *"/.agents/memory/"*|".agents/memory/"*) return 1 ;;
  esac
  case "$1" in
    *"/.claude/"*"/memory/"*.md|*"/.gstack/"*"/memory/"*.md|*"/.claude/"*memory*.md) return 0 ;;
  esac
  return 1
}

remind() {
  echo "🔁 MEMORY MIRRORING (absolute rule): you wrote durable knowledge to session/host memory:"
  echo "     $1"
  echo "   You MUST mirror the same content into the repo at .agents/memory/<slug>.md and add a"
  echo "   pointer to .agents/memory/MEMORY.md so every clone shares it."
  echo "   See .agents/rules/memory-mirroring.md."
}

# --- Write/Edit arm -----------------------------------------------------------------------------
# The jq arm was right and the "tolerant grep" beside it was not: `[^"]+` stops at the first
# ESCAPED quote, so on a host without jq a memory file named with a quote or a backslash was read
# as a truncated path, matched none of the cases above, and the reminder this hook exists to print
# never printed. The shared reader falls back to python3 instead, so both hosts answer the same.
fp="$(hook_file_path_of "$input" || printf '')"
if [ -n "$fp" ]; then
  if is_host_memory_path "$fp"; then remind "$fp"; fi
  exit 0
fi

# --- Bash arm (heuristic — see the header) ------------------------------------------------------
cmd="$(hook_command_of "$input" || printf '')"
[ -z "$cmd" ] && exit 0

# A redirect target is a write by construction. The shared reader owns "what does this command
# redirect into", so `>&2` is not mistaken for a path (lib/command-scan.sh).
hit=""
while IFS= read -r target; do
  [ -n "$target" ] || continue
  if is_host_memory_path "$target"; then
    hit="$target"
    break
  fi
done <<< "$(hook_redirect_targets "$cmd" || printf '')"

# Otherwise: a writer verb somewhere in the command, and a host-memory path spelled anywhere in
# it — quoted or not, because a path is data and quoting does not change where the bytes land.
if [ -z "$hit" ]; then
  words="$(hook_statement_all_words "$cmd" || printf '')"
  if printf '%s\n' "$words" | grep -qxE 'tee|cp|mv|sed|install|rsync|truncate|dd|python|python3|node|perl|ruby'; then
    while IFS= read -r token; do
      [ -n "$token" ] || continue
      if is_host_memory_path "$token"; then
        hit="$token"
        break
      fi
    done <<< "$(printf '%s\n' "$cmd" | grep -oE "[^[:space:]\"'|;&<>()]+" || printf '')"
  fi
fi

if [ -n "$hit" ]; then remind "$hit"; fi
exit 0
