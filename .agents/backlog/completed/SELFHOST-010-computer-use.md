---
title: 'SELFHOST-010: computer/browser use tool (vision → click/type, approval-gated, takeover)'
status: done
completed: 2026-07-19
created: 2026-07-16
priority: medium
urgency: later
area: packages/agent-tools, packages/agent-core
depends_on: []
---

# Computer / browser use

## Outcome (DONE 2026-07-19 — P1)

Shipped: neutral computer-use driver port + approval-gated perceive/act tool in
`packages/agent-tools/src/computer-use/` (`computer-tool.ts`, `ScriptedComputerDriver`, zero-dep
`PageComputerDriver`, takeover mode, permission wiring; PR #1230 per git history). Spec:
`.agents/spec-docs/done/SELFHOST-010-computer-use.md` (GATE-COMPLETE 2026-07-19, TC-01..08). Remaining P2
(agent-run real-browser verification) / P3 (concrete surface driver) / P4 (mechanical neutrality floor) are
named in the spec's Tasks section, not yet filed as separate backlog items.

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator, absent in Robota: a vision-driven GUI/browser control loop (screenshot → reason → click/type),
gated by approvals, with a human **takeover** mode for credentials.

## What

A neutral **computer-use tool** in `agent-tools` (screenshot-perceive → action) with a screen/browser driver
behind an adapter; every significant action **gated by the existing permissions**; a takeover mode that hands
control to the human for credentials. Mechanism only; the target environment wiring lives in the surface.

## Prior Art

OpenAI Operator / Computer-Using-Agent (screenshot→reason→click/type, takeover, approve significant actions,
https://developers.openai.com/api/docs/guides/tools-computer-use , https://openai.com/index/computer-using-agent/);
Hermes full web control (search/browse/vision, https://hermes-agent.nousresearch.com/docs/).

## Test Plan

Unit tests for the action contract + a fake driver; a functional test that a significant action is blocked
until approved and that takeover suspends the loop. Architecture Review sets the tool/driver-adapter boundary
and confirms permission-gating reuse. Security: never auto-run against untrusted targets without approval.
