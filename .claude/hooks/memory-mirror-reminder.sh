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

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && exit 0

# Extract the written file path (jq if available, else a tolerant grep).
if command -v jq >/dev/null 2>&1; then
  fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  fp="$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*:"([^"]+)"/\1/' || true)"
fi
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
