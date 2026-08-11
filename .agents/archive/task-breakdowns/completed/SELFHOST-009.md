# SELFHOST-009 — rich lifecycle hook catalog (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-009-hook-catalog.md`](../spec-docs/active/SELFHOST-009-hook-catalog.md)
(GATE-APPROVAL ENDORSE + owner sign-off, prior session; grounding re-verified 2026-07-19 + TC-07 agent-run added).
No new hook engine/tier — extend the existing `THookEvent` union + `runHooks`; fire new events from the turn owner;
back the documented catalog with a drift-guard scan. Commit per logical slice.

## Design (approved)

- **agent-core**: add `PreModelCall`, `PostModelCall`, `PermissionDecision` to the `THookEvent` union
  (`hooks/types.ts`) + their `IHookInput` fields. No new runner/executor/dispatch path.
- **agent-session** (turn owner): fire the 3 new events via the already-threaded `runHooks`/`hookTypeExecutors` path —
  `PermissionDecision` after `evaluatePermission` (`permission-enforcer.ts`); `PreModelCall` on `provider_request`
  and `PostModelCall` on `provider_response_normalized` (the SINGLE canonical source — NOT `provider_response_raw`)
  mapped from `onExecutionEvent` (`session-run.ts`). All 3 are **informational-only** (void/un-awaited → cannot
  gate/mutate). The existing `PreToolUse` block path (`runPreToolHook` → `blocked`) is UNCHANGED — documented + tested,
  not re-wired.
- **catalog SSOT** (`packages/agent-core/docs/hook-catalog.md`, new): every named event — timing, fire-site, input
  fields, blocking semantics. Fix `content/guide/permissions-and-hooks.md` (drop phantom `Notification`; add the 6
  omitted real events + the 3 new).
- **drift-guard** (`scripts/harness/scan-hook-catalog.mjs`, new, registered in `run-all-scans.mjs`): FAIL when the
  documented catalog ↔ `THookEvent` union ↔ resolved firing call-sites disagree (resolving variable dispatch:
  `hook_event_name:` literals + `getSubagentHookEvent`/`fireWorktreeHook` mappings).

## Slices (each green + committed)

1. **S1 — new events (agent-core).** Extend `THookEvent` + `IHookInput` with the 3 events. (TC-03 types.)
2. **S2 — fire sites (agent-session).** Fire `PermissionDecision`/`PreModelCall`/`PostModelCall` at the documented
   points via `runHooks`; informational-only. Tests TC-03 (fires once/round, no double-fire, non-blocking) + TC-04
   (13 existing still fire).
3. **S3 — catalog SSOT doc + fix the guide.** New `hook-catalog.md`; correct `permissions-and-hooks.md`.
4. **S4 — drift-guard scan.** `scan-hook-catalog.mjs` + register + red→green fixtures (literal- AND
   variable-dispatched). TC-01.
5. **S5 — remaining tests.** TC-02 (PreToolUse deny → blocked, existing path), TC-05 (single path/no second tier),
   TC-06 (neutrality).
6. **S6 — AGENT-RUN verification (TC-07).** The agent runs the real `robota` CLI with a `settings.json` `PreToolUse`
   deny hook and observes a tool blocked in a live run; evidence saved to
   `.agents/evals/scenarios/selfhost-009-pretooluse-gate-agent-run.md`.

## Test Plan

- Unit/functional: TC-01 (scan red→green), TC-02 (PreToolUse deny blocks the tool), TC-03 (new events fire once/round,
  informational-only), TC-04 (13 existing events still fire), TC-05 (single runHooks/blocked path), TC-06 (neutrality).
- AGENT-RUN: TC-07 — real `robota -p` + settings.json PreToolUse deny hook → tool blocked; evidence captured.
- Regression: `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-session test`, `typecheck`, `lint`,
  `pnpm harness:scan` (incl. the new hook-catalog scan).
