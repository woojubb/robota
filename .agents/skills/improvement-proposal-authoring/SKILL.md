---
name: improvement-proposal-authoring
description: Turns classified conformance findings into a prioritized improvement proposal — maps each P0/P1 finding to a remediation, a proposed follow-up backlog ID + type prefix, and a mechanical-guard recommendation. Use as the remediation-planning step after an architecture-conformance-audit run.
---

# Improvement Proposal Authoring

Single-responsibility step: convert the report's `AF-NN` findings into an actionable, prioritized
remediation plan. It plans fixes; it does not apply them (spec-before-code — each fix becomes its own
backlog).

## Rule Anchor

- `.agents/rules/spec-workflow.md` > HARD GATE (fix specs authored from concrete findings only)
- `AGENTS.md` > Document Discovery Policy — prefer a mechanical check over adding more prose
- Reference schema: `.design/architecture-audit/2026-06-13/improvement-proposal.md` (INFRA-002)

## Steps

1. **P0 → focused backlogs.** One follow-up draft backlog per P0 finding (it actively misleads, so it
   gets its own scope). Record proposed ID + type prefix + fix kind (code / doc / rule-or-harness guard).
2. **P1 → thematic backlogs.** Group related P1 findings into coherent backlogs (e.g. "purge stale
   package names" covers all rename drift) — keeps each PR reviewable under one-backlog-per-PR.
3. **P2 → single cleanup backlog.** Batch cosmetic fixes.
4. **Guard recommendation per finding.** For each finding, state whether a mechanical guard would
   prevent recurrence, and which one — the recurring-drift classes should map to a check in
   `scripts/harness/` (e.g. the workspace-package-name guard in `check-architecture-conformance.mjs`).
5. **Sequencing.** Order the backlogs; note dependencies (guards before the sweeps they verify).

## Rules

- Every P0 and P1 finding MUST map to a remediation + a proposed backlog ID + type prefix.
- Proposed backlog IDs are _proposed_ — each still passes GATE-WRITE → GATE-APPROVAL before
  implementation. Allocate collision-free IDs against existing `.agents/spec-docs/**`.
- Recurring drift MUST carry a mechanical-guard recommendation (prose-only remediation is the last resort).

## Output

`.design/architecture-audit/<date>/improvement-proposal.md`, plus (when invoked from an audit backlog
whose criteria require it) one draft backlog per P0 finding under `.agents/spec-docs/draft/`.

## What This Skill Does NOT Do

- Apply any fix → fixes are separate backlogs through the gate pipeline.
- Assign findings or severities → that is `conformance-finding-report`.
- Approve or implement the proposed backlogs → `backlog-pipeline`.
