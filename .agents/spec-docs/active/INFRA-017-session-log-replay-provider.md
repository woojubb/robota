---
status: in-progress
type: INFRA
tags: [testing, provider]
---

# INFRA-017: session-log replay provider + typed log-event schema

First implementation increment of the TEST-008 north star (drive the real CLI agent programmatically).
Delivers the **provider axis**: a provider that replays a recorded **session log** so a deterministic
conversation can run without a network model. Builds on the TEST-008 replay-coverage audit (the
session log already records `user` / `text_delta` / `tool_call` / `tool_result` / `assistant{history}`
— replay-complete, no enrichment of the data needed).

## Problem

The built CLI and the framework can only run a real conversation against a live network provider
(anthropic/openai/qwen/deepseek). There is no way to drive the agent's core loop deterministically
without an API key, which blocks automated end-to-end conversation tests (e.g. SCREEN-010 TC-02/03:
streaming → commit) and any reproducible/offline agent run.

Reproduction: there is no provider type that replays a prior session; `provider-startup` only knows
the network providers, so a conversation turn cannot be produced offline/deterministically.

Two concrete gaps:

1. The session-log event schema (`text_delta`, `tool_call`, `tool_result`, `assistant`, …) is an
   **implicit set of string literals** in `agent-session` (`session-run.ts`, `permission-enforcer.ts`)
   with no exported typed contract, so a reader cannot share it type-safely.
2. There is no provider that consumes a session log and re-emits its recorded turns.

## Architecture Review

### Affected Scope

- `packages/agent-session` — export a **typed log-event schema** (SSOT for the events the logger
  already writes); the writer uses it. No new format, no behavior change to what is logged.
- **New package** `packages/agent-provider-replay` (`@robota-sdk/agent-provider-replay`) — a provider
  that reads a session-log JSONL and re-emits each recorded turn (text deltas → tool calls → assistant
  → completion). Depends on `agent-core` (provider interface) + `agent-session` (log schema).

### Alternatives Considered

**Alt A (chosen): typed log schema in `agent-session` + replay provider in a new dedicated package**

- Pro: correct dependency direction — the new package may depend on `agent-session` (log schema) and
  `agent-core` (provider interface); isolated and reusable beyond the CLI; `agent-provider` stays
  lean (core-only). User-approved (2026-06-28).
- Con: one new package + a small schema-extraction in `agent-session`.

**Alt B: replay provider inside `agent-provider`**

- Pro: lives with the other providers.
- Con: `agent-provider` depends only on `agent-core` and must not depend on `agent-session`
  (layering); it would force the session-log schema down into `agent-core` (wrong owner) or parse raw
  JSONL by string literals (fragile, duplicated schema). Rejected.

**Alt C: replay provider inside `agent-cli`**

- Pro: simplest; CLI already depends on everything.
- Con: CLI-coupled, not reusable by the testing package / embedding. Rejected for the provider itself
  (the CLI still owns the `--provider replay` flag wiring).

### Decision

Alt A. Formalize the existing log events as a typed schema owned by `agent-session`; put the replay
provider in a new `@robota-sdk/agent-provider-replay` package. The programmatic interaction-channel
adapter, the transport-agnostic assembly factory, and the `--provider replay --session-log <path>`
CLI flag are the **next increment** (tracked in TEST-008) and are out of scope here so this stays a
focused, shippable unit.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-session (schema), new agent-provider-replay
- [x] Sibling scan 완료 — `agent-provider` (real providers) unaffected; replay provider is a separate
      package, not added to `agent-provider` (layering)
- [x] 대안 최소 2개 검토 완료 (A dedicated pkg / B agent-provider / C agent-cli)
- [x] 결정 근거 문서화 완료 (dependency direction + user approval)

## Solution

> **Substrate correction (2026-06-28, from deeper audit):** the replay substrate is **not** the
> observability events (`user`/`text_delta`/`assistant`) but the **provider/tool execution layer**,
> which the log already records and `session-log-validation.ts` already keys: `provider_request` +
> `provider_native_raw_payload` / `provider_response_normalized` (by `executionId`+`round`), and
> `tool_execution_request` / `tool_execution_result` (by `executionId`+`toolCallId`).
> `validateSessionReplayLogEntries` already proves a log carries all of these (replay-complete).

1. **Typed log-event schema (agent-session) — DONE:** `session-log-events.ts` exports
   `SESSION_LOG_EVENT` (event-name SSOT, incl. the provider/tool replay substrate), the replay key
   types (`IProviderEventKey`, `IToolEventKey`), `ISessionLogLine`, and `isSessionLogEvent`. Additive
   — no change to emitted JSONL. (`session-log-validation.ts` / `session-log-replay.ts` can adopt
   these names incrementally.)
2. **`@robota-sdk/agent-provider-replay`:** a provider implementing the `agent-core` provider contract
   that, given a loaded session log (`loadSessionLogEntries`), answers each provider call by the
   recorded response for its `executionId`+`round` key — re-emitting `provider_native_raw_payload`
   stream events for streaming and resolving with `provider_response_normalized`. Reuses the existing
   key extraction from `session-log-validation.ts` (extracted to a shared helper as needed).
3. **Determinism:** replay is purely a function of the log; no network, no clock/random dependence in
   the emitted content. A log that passes `validateSessionReplayLogEntries` is guaranteed replayable.

## Affected Files

- `packages/agent-session/src/session-logger.ts` (+ typed schema module) and the `log()` call sites
  in `session-run.ts` / `permission-enforcer.ts` / `session.ts`.
- `packages/agent-provider-replay/**` (new package: src, package.json, tsconfig, tsdown, docs/SPEC.md).
- Workspace wiring (pnpm-workspace already globs `packages/*`; build order via deps).

## Completion Criteria

- [x] TC-01: `agent-session` exports a typed log-event schema (`session-log-events.ts`:
      `SESSION_LOG_EVENT`, `IProviderEventKey`, `IToolEventKey`, `ISessionLogLine`,
      `isSessionLogEvent`) covering the events the logger emits incl. the provider/tool replay
      substrate; additive (no change to emitted JSONL); `agent-session` typecheck green.
- [ ] TC-02: `@robota-sdk/agent-provider-replay` exists as a workspace package depending only on
      `@robota-sdk/agent-core` + `@robota-sdk/agent-session` (verified by `pnpm harness:scan`
      dependency-direction).
- [ ] TC-03: given a recorded session log, the replay provider answers each provider call by the
      recorded response for its `executionId`+`round` key — re-emitting native stream payloads and
      resolving with `provider_response_normalized` (unit test).
- [ ] TC-04: given a log whose turn contains a tool execution, the replay flow returns the recorded
      `tool_execution_result` for the matching `executionId`+`toolCallId` (unit test).
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-provider-replay typecheck` and
      `pnpm --filter @robota-sdk/agent-session typecheck` exit 0.
- [ ] TC-06: `pnpm build` (affected) exits 0 and `pnpm harness:scan` is green (incl. SPEC for the new
      package, dependency-direction, naming `@robota-sdk/*`).

## Test Plan

Test strategy derived from type=INFRA, tags=[testing,provider]: vitest unit tests + harness scans.

| TC-ID | Test Type | Tool / Approach                                                             | Notes                                          |
| ----- | --------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| TC-01 | automated | vitest: log a sample turn, snapshot JSONL lines, assert unchanged + typed   | Schema is formalization only, no format change |
| TC-02 | automated | `pnpm harness:scan` dependency-direction + workspace-refs                   | New package deps = core + session only         |
| TC-03 | automated | vitest: feed a recorded log, assert ordered text deltas + assistant content | Core replay behavior                           |
| TC-04 | automated | vitest: log with a tool call → assert tool_call then assistant re-emitted   | Tool-call replay                               |
| TC-05 | automated | `pnpm … typecheck`                                                          | Must exit 0                                    |
| TC-06 | automated | `pnpm build` + `pnpm harness:scan`                                          | Must exit 0 / all scans green                  |

## User Execution Test Scenarios

Not a standalone user-facing surface yet — the replay provider becomes user-runnable when the CLI
`--provider replay --session-log <path>` flag lands (next increment, TEST-008). This increment is
validated by the unit tests + harness scans above (recorded as Test Plan evidence). The end-to-end
"run a recorded conversation in the real CLI" user scenario is owned by the follow-up increment.

## Tasks

- [x] `.agents/tasks/INFRA-017.md` — created (GATE-IMPLEMENT)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-28

- Frontmatter: `---`; `type: INFRA` (valid); `tags: [testing, provider]`.
- Problem: concrete (no replay provider; implicit log schema) + reproduction (provider-startup knows
  only network providers); no TBD.
- Architecture Review: 4/4 checklist `[x]`; sibling scan `[x]`; 3 alternatives (A dedicated pkg / B
  agent-provider / C agent-cli) with pro/con; decision cites dependency direction + user approval.
- Completion Criteria: TC-01–TC-06 all TC-prefixed, command/observable form.
- Test Plan: 6 rows matching TC-01–TC-06; each has type + tool.
- Structure: Tasks placeholder; empty Evidence Log; no `## Status`/`## Classification`.
- Result: PASS → `draft` → `review-ready` → `backlog/`.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-28

- Prior gate: GATE-WRITE ✅ PASS.
- User set the two binding design decisions for this spec (verbatim selections): replay provider home
  = "전용 패키지 신설 (추천)"; CLI opt-in = "--provider replay --session-log <path> 플래그 (추천)".
  Then authorized proceeding: "좋아 계속 진행해". The spec encodes exactly those decisions.
- No Architecture Review / type / tags changed after approval.
- Result: PASS → `review-ready` → `approved` → `todo/`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-28

- Prior gate: GATE-APPROVAL ✅ PASS.
- Tasks file `.agents/tasks/INFRA-017.md` created; path recorded in `## Tasks`; tasks map to TC-01–06.
- Result: PASS → `approved` → `in-progress` → `active/`.

### Implementation progress | 2026-06-28

- **T1 / TC-01 DONE:** added `packages/agent-session/src/session-log-events.ts` (typed event-name SSOT
  - replay key types) and exported it from the package index; `agent-session` typecheck green. Additive
    only — no change to emitted JSONL.
- **Substrate correction recorded** (see Solution): the replay substrate is the provider/tool
  execution event layer (`provider_request`/`provider_native_raw_payload`/
  `provider_response_normalized`, `tool_execution_request`/`result`), already keyed by
  `session-log-validation.ts` and proven replay-complete by `validateSessionReplayLogEntries` — not
  the observability events the first draft assumed. This simplifies the replay provider (reuse the
  existing keying + loader `loadSessionLogEntries`).
- **Remaining (T2–T4):** scaffold `@robota-sdk/agent-provider-replay` (new package, must pass SPEC +
  dependency-direction + build-contracts scans), implement the provider against the provider-event
  substrate, unit tests, verify. This is the next focused chunk.
