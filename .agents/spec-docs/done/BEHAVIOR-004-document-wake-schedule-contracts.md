---
status: done
type: BEHAVIOR
tags: [async, cli]
---

# BEHAVIOR-004: Document the FLOW wake/schedule/monitor contracts

> Source: INFRA-002 audit findings **AF-07** (P1) + **AF-09** (P1). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

The FLOW-001~006 agent wakeup/scheduling stack (shipped, merged to `main`) is undocumented across the
architecture specs, and one related spec section is now stale:

- **AF-07 (stale [Planned] banner):** `.agents/specs/architecture-map/agent-system.md:129-139` marks the
  WebSocket Sidecar Mode "[Planned — not yet implemented]" and says `createWsHandler` / `useWsSession`
  "do not exist". They DO exist: `createWsHandler` (`packages/agent-transport/src/ws/ws-handler.ts:51`)
  and `useWsSession` (`packages/agent-web-ui/src/hooks/useWsSession.ts:43`). Only the CLI `--web` /
  `--web-port` flags and `startWebSidecarServer()` remain unimplemented.
- **AF-09 (undocumented wake contracts):** the FLOW wake/schedule/monitor behavior has zero coverage:
  - `.agents/specs/background-task-layer.md` documents the background-task layer but has no wake / cron /
    schedule / monitor content (scheduled-task-runner, managed-shell-process line-wake-matcher,
    `background_task_waking` event).
  - `.agents/specs/command-inventory.md` lists no `/schedule` or `/monitor` command.
  - `.agents/specs/architecture-map/cross-cutting-contracts.md` does not mention the
    `spawnScheduledWake` / `spawnMonitorWake` host-context bridges
    (`packages/agent-framework/src/command-api/host-context.ts:152,161`).

**Reproduction condition:** `rg -n 'schedule|monitor|wake|cron' .agents/specs/background-task-layer.md`
→ nothing; the agent-system.md banner still says the WS APIs "do not exist".

## Architecture Review

### Affected Scope

- `.agents/specs/architecture-map/agent-system.md` (AF-07 banner)
- `.agents/specs/background-task-layer.md` (AF-09 wake/schedule/monitor)
- `.agents/specs/command-inventory.md` (AF-09 `/schedule`, `/monitor`)
- `.agents/specs/architecture-map/cross-cutting-contracts.md` (AF-09 host-context bridges)
- (documentation only — no `packages/*` production code; describes already-shipped FLOW-001~006 behavior)

### Alternatives Considered

1. **Fix only the stale AF-07 banner.** Pro: smallest. Con: leaves the entire wake/schedule contract
   undocumented (AF-09), which is the audit's clearest "docs lag code" gap. Rejected.
2. **Document the full wake/schedule/monitor contract + fix the WS banner.** Pro: closes both findings;
   the shipped FLOW behavior gains a documented contract that the conformance methodology can track.
   Con: additive content across four docs. Chosen.

### Decision

Alternative 2 — document the FLOW wake/schedule/monitor contract where each concern is owned
(background-task-layer for the runner/event behavior, command-inventory for the commands,
cross-cutting-contracts for the host-context bridges) and downgrade the AF-07 WS banner to
"partially implemented". This is descriptive documentation of behavior already in `main`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 4 specs listed above; no `packages/*` source
- [x] Sibling scan 완료 — FLOW-001~006 reviewed: scheduled-task-runner, line-wake-matcher, host-context bridges, /schedule+/monitor command module
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records owner-placed documentation of shipped behavior

## Solution

1. **AF-07** — rewrite the `agent-system.md` WS Sidecar section: it is "partially implemented"
   (`createWsHandler` + `useWsSession` + `agent-web-ui` exist; only CLI `--web`/`--web-port` +
   `startWebSidecarServer()` remain), with the real `file:line` references.
2. **AF-09** — add a "Wake & Scheduling" section to `background-task-layer.md` covering the
   scheduled-task-runner (cron/one-shot agent wake), the managed-shell-process monitor + line-wake-matcher,
   and the `background_task_waking` event; add `/schedule` and `/monitor` rows to `command-inventory.md`;
   add the `spawnScheduledWake`/`spawnMonitorWake` host-context bridges to `cross-cutting-contracts.md`.

## Affected Files

- `.agents/specs/architecture-map/agent-system.md`
- `.agents/specs/background-task-layer.md`
- `.agents/specs/command-inventory.md`
- `.agents/specs/architecture-map/cross-cutting-contracts.md`

## Completion Criteria

- [x] TC-01: `agent-system.md` WS section no longer claims `createWsHandler`/`useWsSession` "do not
      exist"; it states they are implemented and scopes the remaining work to the CLI `--web` flags +
      `startWebSidecarServer()`.
- [x] TC-02: `rg -n 'schedule|monitor|wake' .agents/specs/background-task-layer.md` returns wake content;
      `command-inventory.md` lists `/schedule` and `/monitor`; `cross-cutting-contracts.md` names
      `spawnScheduledWake` and `spawnMonitorWake`.
- [x] TC-03: `pnpm harness:scan` exits 0 (incl. conformance).

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                       | Notes           |
| ----- | ---------------------- | --------------------------------------------------------------------- | --------------- |
| TC-01 | CI pipeline smoke test | `rg` over agent-system.md (no "do not exist"; partial-impl statement) | Command-form    |
| TC-02 | CI pipeline smoke test | `rg` over background-task-layer / command-inventory / cross-cutting   | Command-form    |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                            | doc-only change |

## Tasks

- [x] `.agents/tasks/completed/BEHAVIOR-004.md` — 완료 후 아카이브됨 (TC-01/TC-02/TC-03 + Test Plan)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [async, cli]` present.
- Problem section: concrete symptoms with `file:line` refs (agent-system.md:129-139, ws-handler.ts:51, useWsSession.ts:43, host-context.ts:152,161); reproduction condition via `rg` command; no TBD/TODO/vague text.
- Architecture Review: all 4 checklist items `[x]`; Sibling scan `[x]` with FLOW-001~006 completion evidence; 2 alternatives with pro/con each; Decision references the trade-off (additive across 4 docs vs. closing both AF-07/AF-09).
- Completion Criteria: TC-01/TC-02/TC-03 all TC-N prefixed; each in command/observable form; no banned vague phrases.
- Test Plan: section present; 3 rows (TC-01, TC-02, TC-03) — count matches 3 TC-N in Completion Criteria; each row has non-empty Test Type and Tool/Approach; no "manual"/"TBD" rows.
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status` or `## Classification` body sections.
- TC-N count match confirmed: Completion Criteria = 3, Test Plan = 3.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval: user approved the follow-up sequencing plan with "승인" (which explicitly includes BEHAVIOR-004 — document FLOW wake contracts) and repeatedly directed continued execution with "진행해" and "계속 이어서 진행해". Per skill, "승인" / "진행해" count as explicit approval.
- Direct & unambiguous: the "승인" covered the sequencing plan that names BEHAVIOR-004 specifically; not approval of a different item.
- No post-approval drift: frontmatter (`type: BEHAVIOR`, `tags: [async, cli]`) and Architecture Review checklist were set at GATE-WRITE (2026-06-13) and unchanged after approval.
- NON-COMPLIANCE check: no implementation/tasks file exists yet (`.agents/tasks/BEHAVIOR-004.md` marked 미생성); no code edits or commits performed before this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/BEHAVIOR-004.md`.
- Tasks file path recorded in spec `## Tasks` section (updated from 미생성 placeholder to 생성 완료).
- Tasks correspond to Completion Criteria — one task per TC-N: TC-01 (fix AF-07 WS banner in agent-system.md), TC-02 (document AF-09 wake/schedule/monitor across background-task-layer + command-inventory + cross-cutting-contracts), TC-03 (verify `pnpm harness:scan` exits 0).
- Tasks file includes a `## Test Plan` section (894 chars body, ≥50 required) satisfying the test-plans harness scan [AF-24]; mirrors the spec's 3-row TC-01/TC-02/TC-03 plan.
- NON-COMPLIANCE check: no implementation commits exist ahead of this gate; tasks file was created at this gate run.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks completion: all 3 tasks in `.agents/tasks/BEHAVIOR-004.md` are `[x]` (TC-01 WS banner fix, TC-02 wake/schedule/monitor docs, TC-03 harness scan); none blocked or pending.
- TC-01: `rg 'do not exist|not yet implemented' agent-system.md` → no match (exit 1); section is now `## WebSocket Sidecar Mode [Partially implemented]`, marks `createWsHandler` (ws-handler.ts:51) and `useWsSession` (useWsSession.ts:43) as "exists", and scopes remaining work to CLI `--web` flags + `startWebSidecarServer()`.
- TC-02: `background-task-layer.md` has `### Wake & Scheduling (FLOW-001~006)` (scheduled-task-runner cron/one-shot, managed-shell-process monitor + line-wake-matcher, `background_task_waking` event); `command-inventory.md` lists `/schedule` and `/monitor` rows; `cross-cutting-contracts.md` names `spawnScheduledWake` and `spawnMonitorWake` host-context bridges.
- TC-03: `pnpm harness:scan` → `HARNESS_SCAN_EXIT=0`; all 24 scans passed including conformance (`dependencyDirection: pass`, `conformant: true`).
- Build/test: N/A — documentation-only change across 4 `.agents/specs/*` docs; no `packages/*` production source modified.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- **[GATE-COMPLETE: TC-01]** Verified: `rg -n 'do not exist|not yet implemented' .agents/specs/architecture-map/agent-system.md` → no match, exit 1. Section is now `## WebSocket Sidecar Mode [Partially implemented]` (line 129); `createWsHandler` cited at `packages/agent-transport/src/ws/ws-handler.ts:51` (source confirmed: `export function createWsHandler`), `useWsSession` at `packages/agent-web-ui/src/hooks/useWsSession.ts:43` (source confirmed: `export function useWsSession`); remaining work scoped to `agent-cli` `--web` flag + `startWebSidecarServer()` (marked `pending`). Checkbox `[x]`.
  - Test reference: TC-01 row = CI pipeline smoke test, `rg` content check over agent-system.md (Command-form). Verified by command above.
- **[GATE-COMPLETE: TC-02]** Verified: `background-task-layer.md` has wake content (`### Wake & Scheduling`, scheduled-task-runner cron/one-shot via `croner`, managed-shell-process monitor + `line-wake-matcher`, `background_task_waking` event); `command-inventory.md` lists `/schedule` and `/monitor` rows (lines 22-23); `cross-cutting-contracts.md` names `spawnScheduledWake` and `spawnMonitorWake` (line 50). Source anchors confirmed: `packages/agent-framework/src/command-api/host-context.ts:152` (`spawnScheduledWake`), `:161` (`spawnMonitorWake`). Checkbox `[x]`.
  - Test reference: TC-02 row = CI pipeline smoke test, `rg` content check over background-task-layer / command-inventory / cross-cutting (Command-form). Verified by commands above.
- **[GATE-COMPLETE: TC-03]** Verified: `pnpm harness:scan` → all 24 scans passed (incl. `conformance`); exit code 0. Checkbox `[x]`.
  - Test reference: TC-03 row = CI pipeline smoke test, `pnpm harness:scan` exit 0 (doc-only change). Verified by command above.
- **Test Plan coverage:** all 3 rows (TC-01/TC-02/TC-03) are CI pipeline smoke tests with command-form tools; each verified by its command. No `manual` rows requiring a skip reason.
- **User-Execution done-gate:** N/A — spec has no `## User Execution Test Scenarios` section; this is documentation-only correction (AF-07/AF-09) describing already-shipped FLOW-001~006 behavior. No `packages/*` production code changed.
- **Artifact actions:** Tasks file archived `.agents/tasks/BEHAVIOR-004.md` → `.agents/tasks/completed/BEHAVIOR-004.md`; spec `## Tasks` section updated to the archived path and checked `[x]`.
- **Summary:** All 3 Completion Criteria `[x]` with matching GATE-COMPLETE evidence; Test Plan fully covered; tasks archived. Status upgrade verifying → done authorized.
