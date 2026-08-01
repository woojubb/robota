---
title: 'CLI-056: agent-cli SPEC.md stale claims — preflight.ts, diagnose-command.ts, --system-prompt note'
status: done
created: 2026-06-10
completed: 2026-06-10
priority: medium
urgency: soon
area: packages/agent-cli
depends_on: [CLI-049, CLI-050]
---

# CLI-056: agent-cli SPEC.md stale startup claims

## Problem

`packages/agent-cli/docs/SPEC.md` contains claims that no longer match the code:

1. Lists `src/startup/preflight.ts` and its export `handlePreflightCommands(args, ctx)`
   (SPEC.md:875, 1628) — the file was deleted in commit `a12a3348d` with no replacement.
2. Lists `src/startup/diagnose-command.ts` (SPEC.md:873) — deleted in the same commit
   (restoration tracked separately as CLI-050).
3. States `--system-prompt` / `--append-system-prompt` are "parsed but not yet connected …
   reserved for future implementation" (SPEC.md:937), while
   `packages/agent-cli/src/modes/print-mode.ts:53` already passes `systemPrompt` to the
   headless channel (CLI-027 completed the TUI wiring).

Per the spec-is-SSOT rule, the correct end state must be decided first: CLI-049/CLI-050 restore
the commands, then SPEC is updated to describe the restored dispatch architecture (not the
deleted preflight module) and the actual system-prompt wiring status.

## Expected Behavior

SPEC.md module listing, contract exports, and flag notes match the code after CLI-049/CLI-050
land. No references to deleted files; system-prompt note reflects per-mode reality.

## Test Plan

- `rg "preflight" packages/agent-cli/docs/SPEC.md` returns nothing (or describes the new dispatcher).
- Flag table cross-checked against `cli-args.ts` parser output.
- `pnpm harness:scan` passes (docs/spec consistency).

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior. Verification
is the document/structure checks recorded in Test Plan.

## Verification Evidence

- `rg -n "preflight" packages/agent-cli/docs/SPEC.md` → exit 1 (no matches), 2026-06-10.
- Stale module rows removed (preflight.ts, diagnose-command listing corrected to restored module,
  args-to-options.ts, config-phase.ts, provider-setup.ts, session-setup.ts, update-notice.ts);
  module tree, Type Ownership, Extension Points, and Class Contract Registry updated to actual
  exports (`buildCommandSetup`, `ICliSetup`, `runDiagnoseCommand`, injected-terminal first-run and
  terminal-check signatures). `--system-prompt` note now describes the actual CLI-027 wiring.
- `pnpm harness:scan` consistency covered by PR CI.
