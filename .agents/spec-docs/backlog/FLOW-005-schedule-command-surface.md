---
status: review-ready
type: FLOW
tags: [cli, async]
---

# FLOW-005: `/schedule` and monitor command surface (Layer 5)

> Layer 5 of the agent-wakeup epic (see FLOW-001 "Epic & Layering"). Depends on **FLOW-002** (session wake-injection) and **FLOW-004** (monitor capability).

## Problem

After L1–L4 the agent can be woken by timers and monitors, but there is **no user-facing way to create such a wake**. There is no `/schedule` command and no monitor command; the only way to make a scheduled/monitor task is programmatically. Users (and the model, as a tool) need a first-class command to say "wake the agent in N minutes / on this cron / when this process prints X, and run this instruction."

Reproduction: in the CLI, `/schedule` and a monitor command do not exist.

## Architecture Review

### Affected Scope

- `packages/agent-command/src/` — a `/schedule` command module (one-shot delay + cron) and a monitor command, producing a scheduled/monitor background-task request with `agentInstruction`
- `packages/agent-cli/src/startup/command-setup.ts` — register the new command module(s)
- (optional) model-invocable tool variants so the agent can self-schedule

### Alternatives Considered

**Alt A (chosen): a `/schedule` slash command + monitor command in `agent-command`, registered via `command-setup`**

- `/schedule "<when>" "<instruction>"` where `<when>` is a relative delay ("in 20 minutes") or a cron expression; creates a scheduled wake task (FLOW-001 request with `agentInstruction`). A monitor command wraps FLOW-004.
- Pro: uses the established `ICommandModule` registration; consistent with existing slash commands; the agent can also invoke it as a tool
- Con: `<when>` parsing (relative vs cron) needs a small, well-tested parser

**Alt B: only a model-invocable tool, no slash command**

- Pro: less surface
- Con: users cannot schedule directly from the prompt line; inconsistent with Claude Code's `/schedule`; rejected

### Decision

Alt A. Provide a `/schedule` slash command (relative-delay + cron) and a monitor command via `agent-command`, registered in `command-setup`, each creating the corresponding wake task. Expose model-invocable variants so the agent can self-schedule.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing slash commands in `agent-command` reviewed; registration path is `command-setup.ts` (same as init/diagnose/etc.)
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `agent-command`: a `/schedule` command parsing `<when>` (relative delay → one-shot cron-equivalent; or a raw cron expression) + `<instruction>`, creating a scheduled background-task request with `agentInstruction`. A monitor command creating a FLOW-004 process+match request.
2. `command-setup.ts`: register the module(s).
3. Optional model-invocable tool variants.

## Affected Files

- `packages/agent-command/src/` (new command module + tests)
- `packages/agent-cli/src/startup/command-setup.ts`
- `packages/agent-cli/docs/SPEC.md` — document the new commands (SSOT)

## Completion Criteria

- [ ] TC-01: `/schedule "in 1 minute" "<instruction>"` creates a scheduled wake task visible in the background-task workspace with a `nextFireAt` ≈ now+1m and `agentInstruction` set
- [ ] TC-02: `/schedule "<cron>" "<instruction>"` (raw cron) creates a recurring wake task with a correct `nextFireAt`
- [ ] TC-03: invalid `<when>` is rejected with a clear error (no task created)
- [ ] TC-04: the monitor command creates a process+match wake task (FLOW-004) with the given pattern + instruction
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-command test` and `pnpm --filter @robota-sdk/agent-cli test` exit 0
- [ ] TC-06: `pnpm typecheck` exits 0 for affected packages

## Test Plan

Test strategy derived from type=FLOW, tags=[cli, async]: process integration test of the command + unit test of the `<when>` parser.

| TC-ID | Test Type | Tool / Approach                                                       | Notes                                             |
| ----- | --------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| TC-01 | automated | command integration: relative delay                                   | Task with nextFireAt≈now+1m, agentInstruction set |
| TC-02 | automated | command integration: raw cron                                         | Recurring task, correct nextFireAt                |
| TC-03 | automated | unit: `<when>` parser rejects invalid input                           | Clear error, no task                              |
| TC-04 | automated | command integration: monitor command                                  | Process+match wake task created                   |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-command test` + `... agent-cli test` | No regressions                                    |
| TC-06 | automated | `pnpm typecheck`                                                      | Must exit 0 for affected packages                 |

## Tasks

- [ ] `.agents/tasks/FLOW-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present, `status: draft`, `type: FLOW` (valid 11-prefix), `tags: [cli, async]` present — PASS.
Problem: concrete symptom (`/schedule` and monitor command do not exist) + reproduction condition (in the CLI) present, no TBD/TODO/vague — PASS.
Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` with evidence (existing slash commands reviewed, registration path command-setup.ts); 2 alternatives (Alt A, Alt B) each with Pro+Con; Decision references trade-off (Alt A consistency with ICommandModule) — PASS.
Completion Criteria: 6 items all TC-N prefixed (TC-01..TC-06), each command/observable form, no banned vague language — PASS.
Test Plan: `## Test Plan` present; 6 rows (TC-01..TC-06) match 6 Completion Criteria; each has non-empty Test Type + Tool/Approach, no TBD; no manual-tool rows so manual-Notes requirement N/A — PASS.
Structure: Tasks section with placeholder present; Evidence Log present and empty before this entry; no `## Status`/`## Classification` in body — PASS.
TC-N count match confirmed: Completion Criteria 6 = Test Plan 6.
