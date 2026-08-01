---
title: 'SELFHOST-002: explicit plan-mode (plan → review → approve → act) with a plan/todo artifact'
status: done
completed: 2026-07-17
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-core, packages/agent-framework, packages/agent-cli, apps/agent-app
depends_on: []
---

# Plan-mode

## Outcome (DONE 2026-07-17)

Shipped: plan-mode gate (plan -> review -> approve -> act) as `PlanController` + permission-mode gating in
`packages/agent-framework/src/plan/` with `InteractiveSession` wiring (`plan-mode-wiring.test.ts`).
Spec: `.agents/spec-docs/done/SELFHOST-002-plan-mode.md` (GATE-COMPLETE 2026-07-17; landing PRs #1197, #1198).
Verified 2026-07-24: `plan-controller.test.ts` green.

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md). Robota
has permissions/HITL but no dedicated **plan-first-then-execute** gate — a near-universal advantage of coding
agents.

## What

A first-class plan phase: the agent produces a reviewable plan/todo artifact, the user approves, then execution
proceeds; read-only exploration is allowed in the plan phase. Model it as a plan/approval **event + permission
gate** in `agent-core`, wired through `agent-framework` InteractiveSession, surfaced as a `/plan` flow +
plan/todo view in `agent-cli` and `apps/agent-app`. (This mirrors the harness's own spec-first gate at the
product level.)

## Prior Art

Claude Code plan mode (research vs execution, approve-then-implement, https://code.claude.com/docs/); Devin
plan→review→act with dynamic re-planning (https://www.deployhq.com/guides/devin); Cline Plan &amp; Act
(https://docs.cline.bot/core-workflows/plan-and-act); GitHub Copilot cloud agent research→plan→code
(https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent).

## Test Plan

Unit tests for the plan/approval event + permission gate; framework functional test for the plan→approve→act
transition (and read-only-during-plan enforcement); CLI/TUI behavior test for `/plan`. Include User Execution
Test Scenarios (plan surfaces, approval blocks execution until granted).
