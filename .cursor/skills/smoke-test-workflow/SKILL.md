---
name: smoke-test-workflow
description: Run a standard smoke-test workflow after code changes. Use for smoke, verify, regression, preview, API check, UI check, and pre-completion validation.
---

# Smoke Test Workflow

## Rule Anchor
- `.cursor/rules/smoke-test-enforcement.mdc`
- `.cursor/rules/build-and-resolution-rules.mdc`

## When to Use
- After implementing code changes.
- Before reporting task completion.
- When fixing regressions and verifying the fix end-to-end.
- When preview/runtime behavior changed and endpoint contracts must be rechecked.
- When API or UI behavior is uncertain and quick health checks are needed.

## Standard Flow
1. Check existing terminal sessions and avoid duplicate dev servers.
2. Run scoped builds for changed packages/apps.
3. Start or restart required servers.
4. Run API/UI smoke checks for changed behavior.
5. If failure occurs, fix root cause and repeat the same checks.

## Core Checks
- Build checks:
  - `pnpm --filter "@robota-sdk/*" build` (broad)
  - or scoped builds for changed modules.
- API checks:
  - Use `curl` or `node -e "fetch(...)"` against changed endpoints.
- UI checks:
  - Verify route status (for DAG UI: `GET /dag-designer` should return `200`).

## Output Expectations
- Report commands executed.
- Report pass/fail per verification step.
- Include key response fields for API smoke checks.

## Command Templates
- For reusable command blocks, see [COMMANDS.md](COMMANDS.md).
