---
title: 'RULE-012: standing delegated decision authority must not be re-asked as ceremonial approval'
status: in-progress
created: 2026-08-15
priority: high
urgency: soon
area: .agents/rules, .claude/agents, scripts/harness
depends_on: []
---

# RULE-012: recognize standing delegated approval authority

## Problem

The harness distinguishes agent-owned decisions from user-owned decisions, but its spec gate wording
requires an explicit user sign-off without saying how a standing delegation is represented. Agents can
therefore have a direct instruction to decide when evidence is sound and still stop to request a
ceremonial “승인” for each item. That adds no judgment, contradicts the delegated authority, and makes an
autonomous batch repeatedly wait at a gate whose substantive condition has already been satisfied.

## Evidence

- The user corrected the behavior directly on 2026-08-15: “내가 승인하는게 아니라 근거가 타당하면
  너가 알아서 승인하고 넘어가야지.”
- INFRA-100 subsequently demonstrated the intended auditable form: its GATE-APPROVAL quoted that standing
  delegation, independently reproduced the premise, bounded the decision to a reversible internal
  change, and passed without asking again.
- `.agents/spec-docs/done/DATA-005-toolregistry-functiontool-ssot.md` already records a precedent where a
  user-defined correctness condition plus independent `ENDORSE` constituted approval.
- `.agents/rules/backlog-execution.md` already says evidence-driven, reversible, low-blast-radius
  decisions are agent authority, while `.agents/rules/spec-workflow.md` says GATE-APPROVAL requires an
  explicit user sign-off. Neither owner explains how a current standing delegation satisfies the latter,
  so guardian and orchestrator behavior can diverge.

## Proposed Direction

Amend the approval owner documents and guardian contract with one domain-neutral rule: a direct standing
user instruction that delegates a defined class of decisions counts as explicit authorization for an
item only when the agent records the instruction verbatim, proves the stated evidence condition, and
shows the item remains inside that delegated class. Silence, a generic “continue,” or an independent
reviewer verdict alone never counts. Product direction, external contracts, strategy, legal/business
judgment, novel repository practice, and other expressly user-reserved boundaries still halt unless the
delegation clearly includes them.

Add a mechanical guardian fixture with both directions:

- PASS: current-thread standing delegation + independently verified condition + in-scope reversible
  decision.
- FAIL: no delegation, delegation from unrelated context, unmet condition, or a user-reserved decision
  outside the delegated class.

## Enforcement Tier

Rule plus guardian fixture. Prose alone would leave the same judgment split between
`spec-workflow.md`, `backlog-execution.md`, and `backlog-gate-guard`; a fixture must prove the gate uses
the recorded delegation and still fails closed outside it.

## Scope and Sequencing

This item is filed now by `lesson-to-harness` rather than folded into AGREEMENT-002. Implementing it
touches repository policy and must run its own RULE spec/gate pipeline and policy-file approval boundary.
That separate lifecycle is the concrete reason the current architecture batch records the lesson but
does not opportunistically edit policy files.

## Test Plan

- Add focused gate fixtures for valid standing delegation, silence/generic continuation, unmet
  evidence condition, unrelated delegation, and an out-of-scope user-reserved decision.
- Run the focused guardian tests, `pnpm harness:scan:consistency`, `pnpm harness:self-check`, and the
  complete harness test tier.
- Verify existing explicit one-item approval fixtures remain unchanged and INFRA-100's recorded
  approval remains valid under the clarified rule.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable** to this item. It delivers no user-facing product
behaviour: it amends two harness governance documents and adds one repository verification scan. No
package, app, CLI command, TUI surface, or published API changes, so there is no command a user of
the product could run to observe a difference. The verification surface is the harness gate itself —
the fixture set and the mutation proof recorded in the Test Plan above, plus `pnpm harness:scan`.
This matches the surface HARNESS-117 recorded for the same shape of change.

## Bound spec document

`.agents/spec-docs/active/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md`
