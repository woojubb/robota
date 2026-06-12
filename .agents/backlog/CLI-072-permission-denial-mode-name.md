---
title: 'CLI-072: Permission-denial feedback names mode "moderate" while running under plan mode'
status: todo
created: 2026-06-11
priority: low
urgency: later
area: packages/agent-cli
depends_on: []
---

# CLI-072: Wrong mode name in permission-denial feedback (low-confidence)

## Problem

Observed 2026-06-11 (L3, real provider): `robota -p "Change greet.js ..." --dry-run`
(normalized to `--permission-mode plan`) correctly blocked the edit (file unchanged ✓), but
the model's reply said the edit was blocked because "permission mode is set to
**moderate**". The specific, wrong mode name suggests the denial payload returned to the
model (tool error/system prompt) carries a mode label that does not match the active mode
(`plan`). Low confidence: could be model hallucination — needs one look at the denial
message construction.

## Expected Behavior

The permission-denial message delivered to the model names the actual active mode, so user
explanations are accurate.

## Test Plan

- Locate the denial message construction in the permission gate path; unit test asserting
  the active mode name is interpolated.
- `pnpm --filter @robota-sdk/agent-core test` (or owning package)

## User Execution Test Scenarios

- Steps: `robota -p "edit some file" --dry-run`; read the explanation.
- Expected observable result: explanation references plan mode, not another mode name.
- Evidence: (fill after implementation)
