---
title: 'CLI-072: Permission-denial feedback names mode "moderate" while running under plan mode'
status: done
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
- Evidence (2026-06-13, real binary + real Anthropic provider, isolated HOME,
  `--dry-run` → permission mode `plan`):

  ```
  $ robota -p "What is your current permission mode? Answer with just the mode name." --dry-run
  plan
  ```

  Root cause confirmed and fixed: the system prompt injected `Trust level: moderate`
  (config default, a separate axis) — replaced with `- **Permission mode:** <active mode>`
  fed from the session's own resolution (`options.permissionMode ??
TRUST_TO_MODE[defaultTrustLevel] ?? 'default'`). A dry-run edit request explanation now
  describes plan-mode restrictions without misnaming the mode; the edit stays blocked
  (file unchanged). CI tests: `packages/agent-framework/src/__tests__/
system-prompt-builder.test.ts` (CLI-072 mode interpolation over the full union +
  no Trust-level label).
