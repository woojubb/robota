---
status: done
type: BEHAVIOR
tags: [async]
---

# INFRA-033: Decouple HTTP /submit completion from thinking(false) + transport doc/accept cleanup (ARL-04, ARL-07, ARL-06)

## Problem

Three related transport findings from the architecture-refresh pass:

- **ARL-04 (the real defect):** In `packages/agent-transport-http/src/routes.ts`, the `/submit` SSE handler
  resolves its `done` promise **only inside the `thinking` handler**
  (`if (!isThinking && completed) resolve()`). The `complete`/`interrupted`/`error` handlers set
  `completed = true` but never resolve. This is temporal coupling: it works only because the session
  happens to emit a trailing `thinking(false)` in a `finally` after the terminal event. If that ordering
  ever changes, `/submit` hangs. The MCP transport's `waitForCompletion`
  (`agent-transport-mcp/src/mcp-server.ts`) already resolves directly on `complete`/`interrupted`/`error`.
- **ARL-07 (same file, doc):** `routes.ts:5` header comment claims "Each endpoint maps 1:1 to an
  IInteractiveSession API method", but the HTTP surface is a strict subset (no background-task,
  job-group, or execution-workspace methods — those are WS-only).
- **ARL-06 (transport, accept):** `agent-web-ui/src/client/ws-session-client.ts:8` re-exports
  `TServerMessage`/`TClientMessage` from `agent-transport-ws` **module-locally** (not from the package
  root `index.ts`), so it is not a public pass-through. The finding's own remediation is "keep it
  module-local; watch." No code change is warranted — resolve it as reviewed-and-accepted.

**Reproduction condition (ARL-04):** the `/submit` promise's `resolve()` is unreachable from the
terminal-event handlers; only a subsequent `thinking(false)` unblocks `await done`.

## Architecture Review

### Affected Scope

- **`agent-transport-http/src/routes.ts`** (ARL-04 + ARL-07 — same file, handled together): resolve `done`
  directly from the `complete`/`interrupted`/`error` handlers; the `thinking` handler only streams its
  event (no resolve). Reword the L5 comment to reflect the subset surface.
- **`agent-web-ui`** (ARL-06): no code change — accept the module-local re-export; record the decision.
- Docs: `agent-transport-http` SPEC if it restates the 1:1 claim; `.agents/architecture-remediation-log.md`
  (ARL-04/06/07 → Resolved).

### Alternatives Considered

1. **Resolve `done` on the terminal events; thinking only streams (chosen).** Mirrors the MCP transport's
   `waitForCompletion` _pattern of resolving on terminal events_ (not its error semantics — see Decision).
   - _Pro:_ correct regardless of whether/when `thinking(false)` trails the terminal event (most acutely
     on `error`/`interrupted`, where nothing guarantees a trailing `thinking(false)` at all); matches the
     sibling transport's proven resolve-on-terminal pattern.
   - _Con (addressed in the Decision):_ `stream.writeSSE(...)` is **fire-and-forget** (no `await` on the
     current handlers), so the terminal event must be `await`ed **before** `resolve()` or the
     resolve→cleanup→stream-close continuation can race ahead of the flush and drop the terminal event.
2. **Keep the thinking-coupled resolve, just document the dependency.** _Rejected —_ leaves a latent hang
   coupled to event ordering the handler does not control; documenting a fragile mechanism is not fixing
   it.
3. **Bundle ARL-06 as a code change (add a lint/guard against surfacing the WS types from index.ts).**
   _Rejected for now —_ the finding says the current module-local form is acceptable; a mechanical guard
   is speculative scope. Accept-and-watch is the honest resolution.

### Decision

Make the `complete`/`interrupted`/`error` handlers **`async`** and `await stream.writeSSE(...)` **before**
calling `resolve()`, so the terminal event is flushed ahead of the resolve → cleanup → stream-close
continuation (the current `writeSSE` is fire-and-forget). Remove the `thinking`-coupled resolve; the
`thinking` handler only streams. **`error` resolves** (streaming an SSE `error` event and completing the
HTTP response normally) — it does **not** reject like MCP's `waitForCompletion`; the "mirror MCP" framing
applies only to _resolving on terminal events_, not to error semantics. **Leave `cleanup` at its current
site** (drained once after `await done`); that unsubscribes the `thinking` handler so no late
`thinking(false)` can write after close — `resolve()` is already idempotent, so no extra guard is needed.
Reword the `routes.ts:5` 1:1 comment to "exposes the core session methods (a subset; background /
job-group / workspace methods are WS-only)". Accept ARL-06 as-is (module-local, not a public
pass-through) and record it Resolved.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-transport-http (routes.ts: completion + comment), agent-web-ui (accept, no change), remediation log
- [x] Sibling scan 완료 — MCP transport `waitForCompletion` is the correct sibling pattern; the `/submit` handler is the only coupled site — verified by rg; ARL-06 re-export is module-local only (not in `agent-web-ui/src/index.ts`) — verified
- [x] 대안 최소 2개 검토 완료 — 3 alternatives; 2 rejected (document-the-fragility; speculative guard for ARL-06)
- [x] 결정 근거 문서화 완료 — resolve on terminal events (matches MCP sibling); ARL-06 module-local is acceptable per the finding

## Solution

1. In `routes.ts` `/submit`: make the `complete`/`interrupted`/`error` handlers `async` and
   `await stream.writeSSE(...)` **before** `resolve()`. `error` resolves (streams the SSE `error` event),
   not rejects. Remove the `if (!isThinking && completed) resolve()` coupling from the `thinking` handler
   (it streams its event only). Keep `cleanup` at its current site (after `await done`).
2. Add a test for `/submit` completion where the terminal event is NOT trailed by a `thinking(false)`:
   assert the client actually **receives the terminal SSE event** and the response completes (exercises
   the flush ordering, not merely that the promise resolves) — for `complete`, `interrupted`, and `error`.
3. Reword the `routes.ts:5` 1:1 comment to the subset statement.
4. Accept ARL-06: no code change; record it Resolved (module-local re-export, not a public pass-through).
5. Mark ARL-04/06/07 Resolved in the remediation log. (No `agent-transport-http` SPEC edit — grep-verified
   the SPEC contains no "1:1" claim.)
6. Build/typecheck/affected tests + full-repo typecheck + `pnpm harness:scan` 45/45.

## Affected Files

- `packages/agent-transport-http/src/routes.ts` (async terminal handlers, await-write-before-resolve; reword comment)
- a `packages/agent-transport-http` test for `/submit` completion (terminal event received) without the trailing-thinking dependence, covering complete/interrupted/error
- `.agents/architecture-remediation-log.md` (ARL-04, ARL-06, ARL-07 → Resolved)

## Completion Criteria

- [ ] TC-01: `/submit`'s `done` promise resolves from the `complete`/`interrupted`/`error` handlers (not only from `thinking`); `rg` shows no `if (!isThinking && completed) resolve()` coupling remains.
- [ ] TC-02: A test drives `/submit` where the terminal event is NOT followed by a `thinking(false)`; the client **receives** the terminal SSE event (`complete`/`interrupted`/`error`) and the response completes (no hang, no dropped terminal event — exercises the `await writeSSE` flush ordering).
- [ ] TC-03: The `routes.ts` header comment no longer claims a 1:1 mapping; it states the HTTP surface is a subset.
- [ ] TC-04: ARL-06 is recorded Resolved (accepted module-local); no `agent-web-ui/src/index.ts` re-export of `TServerMessage`/`TClientMessage` is introduced.
- [ ] TC-05: `pnpm build`, `pnpm typecheck`, affected tests, full-repo typecheck, `pnpm harness:scan` (45/45) all green.
- [ ] TC-06: remediation-log (ARL-04/06/07 → Resolved) updated. (No agent-transport-http SPEC edit — it has no 1:1 claim.)

## Test Plan

Test strategy (BEHAVIOR + async): an integration/unit test on the `/submit` completion promise with a
scripted session whose terminal event is not trailed by `thinking(false)`; structural greps for the
decoupling + comment; green gate.

| TC-ID | Test Type  | Tool / Approach                                                                | Notes                       |
| ----- | ---------- | ------------------------------------------------------------------------------ | --------------------------- |
| TC-01 | Structural | `rg` — resolve() in terminal handlers; no thinking-coupled resolve             | decoupled                   |
| TC-02 | Unit/Async | vitest — `/submit` resolves on terminal event without trailing thinking        | no hang; idempotent resolve |
| TC-03 | Structural | `rg` — routes.ts comment reworded (no "1:1")                                   | doc accuracy                |
| TC-04 | Structural | `rg` — no `index.ts` re-export of the WS types in agent-web-ui; log Resolved   | ARL-06 accept               |
| TC-05 | Build/CI   | `pnpm build && pnpm typecheck && pnpm test` (affected) + full typecheck + scan | green gate                  |
| TC-06 | Structural | SPEC + remediation-log diff review                                             | docs in sync                |

## Tasks

- [ ] `.agents/tasks/INFRA-033.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter valid; Problem has concrete symptom + reproduction (rg evidence); Architecture Review checklist all [x] with sibling scan; ≥2 alternatives with pro/con; TC-N completion criteria + matching Test Plan rows; Tasks placeholder; empty Evidence Log; no `## Status`/`## Classification`.

### [Design Review] — proposal-reviewer | 2026-07-07

Round 1 → REVISE; Round 2 → **ENDORSE** (verified against code). Decision sound + rule-aligned.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-07

**Status upgrade:** review-ready → approved
Approval mechanism (user rule): approved when the neutral proposal-reviewer ENDORSEs a sound, rule-aligned recommendation. Reviewer returned ENDORSE. No Architecture Review / type / tags changed after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-07

**Status upgrade:** approved → in-progress
Tasks file `.agents/tasks/INFRA-033-http-completion-decoupling.md` created; path recorded; TC-mapped; includes Test Plan / 검증.

### [GATE-VERIFY] — ✅ PASS | 2026-07-07

**Status upgrade:** in-progress → verifying
TC-01: `/submit` resolves from complete/interrupted/error (async, await writeSSE before resolve); thinking-coupled resolve removed. TC-02: 3 new tests assert the client receives the terminal event with no trailing thinking(false) — RED-without-fix confirmed via git stash (all 3 timed out pre-fix). TC-03: no "1:1" in routes.ts. TC-04: ARL-06 accepted (no agent-web-ui index.ts re-export). TC-05: build + full-repo typecheck + agent-transport-http tests (19) + harness:scan 45/45 all green. TC-06: ARL-04/06/07 → Resolved (no SPEC edit).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-07

**Status upgrade:** verifying → done
HTTP /submit completion decoupled from the trailing thinking(false); error resolves (not rejects); comment corrected; ARL-06 accepted. proposal-reviewer ENDORSE (after 1 REVISE catching the fire-and-forget writeSSE flush-ordering race); implemented by architecture-implementer.
