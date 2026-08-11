#!/usr/bin/env bash
# Memory Mirroring rule (.agents/rules/memory-mirroring.md) — cross-boundary half.
#
# The repo-side invariant is mechanized by scripts/harness/scan-memory-mirror.mjs.
# This PostToolUse hook catches the trigger a repo scan cannot see: a write to an
# agent's session/host memory (outside the repo) that must ALSO be mirrored into the
# in-repo .agents/memory/. It reminds loudly; it does not block (the write already
# happened, and session memory is external).
#
# Fires when a Write/Edit targets a path that looks like host/session agent memory
# (…/.claude/…/memory/….md or …/.gstack/…/memory/….md) and is NOT the repo mirror.

set -euo pipefail

# One reader for the payload's file_path, not one per hook. See lib/hook-facts.sh.
# shellcheck source=lib/hook-facts.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-facts.sh"

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && exit 0

# The jq arm was right and the "tolerant grep" beside it was not: `[^"]+` stops at the first
# ESCAPED quote, so on a host without jq a memory file named with a quote or a backslash was read
# as a truncated path, matched none of the cases below, and the reminder this hook exists to print
# never printed. The shared reader falls back to python3 instead, so both hosts answer the same.
fp="$(hook_file_path_of "$input" || printf '')"
[ -z "$fp" ] && exit 0

# In-repo mirror writes are the compliant case — never remind on those.
case "$fp" in
  *"/.agents/memory/"*|".agents/memory/"*) exit 0 ;;
esac

# Session/host agent-memory paths (outside the repo).
case "$fp" in
  *"/.claude/"*"/memory/"*.md|*"/.gstack/"*"/memory/"*.md|*"/.claude/"*memory*.md)
    echo "🔁 MEMORY MIRRORING (absolute rule): you wrote durable knowledge to session/host memory:"
    echo "     $fp"
    echo "   You MUST mirror the same content into the repo at .agents/memory/<slug>.md and add a"
    echo "   pointer to .agents/memory/MEMORY.md so every clone shares it."
    echo "   See .agents/rules/memory-mirroring.md."
    ;;
esac
exit 0
