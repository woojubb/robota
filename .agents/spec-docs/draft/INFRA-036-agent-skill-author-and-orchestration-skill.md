---
status: draft
type: INFRA
tags: [cli]
---

# INFRA-036: agent-skill-author write-agent + standalone capability-extraction orchestration skill (deferred behind the convention guard)

## Problem

INFRA-030 mechanized the agent/thin-skill convention as a document-type contract
(`.agents/specs/document-standards/index.md`) plus a mechanical guard
(`scripts/harness/check-agent-def-convention.mjs`, `harness:scan` → `agent-def-convention`), and built the
read-only `capability-scout`. It intentionally **deferred** two pieces:

1. **`agent-skill-author`** — an LLM write-agent that authors agent/skill files from an approved
   `capability-scout` decomposition.
2. **A standalone `capability-extraction` orchestration skill** — a thin pipeline sequencing
   scout → proposal-reviewer → author → guard.

These were deferred because an LLM-writes-agent-files output is only safe once its **completion gate**
(the convention guard) exists. INFRA-030 delivered that guard; these follow-ons are now unblocked but out
of INFRA-030's scope.

## Why deferred (not dropped)

- The guard + scout + registered type contract already deliver the anti-drift value; the write-agent is
  additive automation, not a correctness gap.
- When built, `agent-skill-author`'s output contract MUST require `agent-def-convention` to pass on its
  emitted files, and any orchestration skill MUST include a post-author **re-audit** step so it mirrors
  the audit→apply→re-audit shape the existing loops (`architecture-refresh`, `documentation-refresh`)
  have. Capability-extraction remains a **specialization dispatched by `lesson-to-harness`**, not a
  parallel institutionalization loop.

## Scope (when scheduled)

- New `.claude/agents/agent-skill-author.md` (edit-capable; output gated on `agent-def-convention`).
- New thin `capability-extraction` skill (scout → proposal-reviewer → author → guard), registered in
  `.agents/skills/index.md`.
- Flip the "Agent definition" document-type row in `document-standards/index.md` from `partial` toward
  `defined` once the author + template exist.

## Notes

Tracked here so the deferral is explicit and gated, per INFRA-030 TC-05. Do not build these until the
convention guard is the completion gate (it now is).
