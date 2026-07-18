---
title: 'HARNESS-030: mechanical floor for capability-reachability / agent-run-verification done-gate'
status: todo
created: 2026-07-18
priority: medium
urgency: later
area: scripts/harness
depends_on: []
---

# Mechanical floor for the capability-reachability done-gate (HARNESS-030)

## Problem

[backlog-execution.md](../rules/backlog-execution.md) → "Capability Reachability — no library-seam N/A dodge" now
forbids marking the user-execution gate "N/A" for a user-facing capability that ships as a library seam no surface
enables, and requires an AGENT-RUN e2e verification in the plan. This is currently **prose + GATE-COMPLETE reviewer
judgment only** — there is no mechanical check, so the exact defect (SELFHOST-008 P2/P3/P4 shipping OFF in the real
agent, unverified) could recur silently.

## Why not mechanized now (infeasible-now, per lesson-to-harness step 8)

"Is this spec a user-facing capability?" and "does some surface actually enable the seam?" are **semantic** judgments a
scan cannot make reliably: a capability is recognized by intent, and "reachable via a surface" requires cross-package
call-graph reasoning (a surface constructing/injecting the seam, possibly behind a config flag). A naive keyword scan
would be high-false-positive/negative. So the rule is enforced by the GATE-COMPLETE guardian (reviewer) for now.

## Scope (best-effort mechanization to attempt)

A `scan-capability-reachability.mjs` (registered in `run-all-scans.mjs`) that raises a **warning-or-fail** when a
spec-doc in `done/` with `type: CAPABILITY`-ish (or an explicit `capability: true` frontmatter flag the spec-writing
standard would add) records its user-execution scenario as "N/A" — nudging the author to justify why a user-facing
capability had no surface flow. Pair it with a lightweight convention: capability specs declare
`user_execution: agent-run` in frontmatter, and the scan asserts a matching agent-run scenario file exists under
`.agents/evals/scenarios/`. Exact heuristic + false-positive budget TBD during implementation; follow the spec-gate.

## Notes

Filed as the mechanization backlog for the 2026-07-18 owner lesson (agent-run capability verification). Until it lands,
the done-gate is guardian-enforced (backlog-gate-guard GATE-COMPLETE) + the prose rule. See
`.agents/memory/agent-run-capability-verification.md`.
