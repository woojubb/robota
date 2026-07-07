---
name: capability-extraction
description: Thin orchestration for turning a discovered recurring role into authored, guard-passing agent/skill files. It holds NO policy — it only sequences predefined agents (capability-scout → proposal-reviewer → agent-skill-author) and reads their signals, gating authoring on an ENDORSE verdict and convergence on the agent-def-convention guard. Every judgement lives in the agents. Dispatched by lesson-to-harness when an approved lesson is "a new recurring role"; not a parallel institutionalization loop.
---

# Capability Extraction — pipeline only

This skill only **calls predefined agents and manages the gate**. It carries no decomposition policy,
no authoring policy, and no review criteria — all judgement (what roles should exist, whether the
decomposition is sound, how to write the files, whether they conform) lives in the agents. The skill
names them, reads their signals, and routes. It is the specialization `lesson-to-harness` dispatches for
a **new-recurring-role** lesson — reuse that loop's approve→institutionalize→enforce discipline; do not
re-implement it here.

The predefined agents (spawn by `agentType`):

- `capability-scout` — read-only; proposes the role decomposition, ends with `DECOMPOSITION: <n> roles`.
- `proposal-reviewer` — read-only; skeptical sign-off, ends with `REVIEW VERDICT: ENDORSE|REVISE|REJECT`.
- `agent-skill-author` — edit-capable; authors/edits the agent/skill files from an ENDORSE'd
  decomposition; its completion evidence is a green `agent-def-convention`.

## Pipeline

1. **Decompose.** Call `capability-scout` on the workflow / task history. Read its `DECOMPOSITION` output
   (roles, sequencing, reuse, flags).
2. **Review.** Pass the decomposition to `proposal-reviewer`. Read its `REVIEW VERDICT`.
3. **Gate.** Proceed only on `ENDORSE`. On `REVISE`, return to step 1 (feed the reviewer's points to the
   scout) — loop until ENDORSE; never author from a REVISE/REJECT decomposition.
4. **Author.** Call `agent-skill-author` with the endorsed decomposition. It writes each named
   `.claude/agents/*.md` / `.agents/skills/*/SKILL.md` to the agent-definition convention and registers
   them.
5. **Re-audit.** Run the `agent-def-convention` guard (`pnpm harness:scan` → `agent-def-convention`, plus
   `check-document-standards-index` if a document-type row changed) over the authored files. This
   mechanical PASS/FAIL is the convergence signal — the analogue of an auditor's `ACTIONABLE FINDINGS`.
6. **Converged?** Stop only when the re-audit is green. If it fails, route the guard's findings back to
   `agent-skill-author` (step 4) and re-audit. Never stop on a round count.
7. **Land** the authored files through the repo's normal flow; pass any collisions/follow-ons the author
   returned into the repo's gated backlog.

That is the whole skill. Everything else is the agents'.
