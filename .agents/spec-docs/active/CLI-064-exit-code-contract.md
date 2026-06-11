---
status: in-progress
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-064: Print-mode exit-code contract — provider errors must not exit 0

## Problem

Reproduced 2026-06-11 on npm-installed `3.0.0-beta.73` with a real provider (product
verification L1/L3):

1. `robota -p "hi"` with an invalid API key → a real HTTP 401 (`authentication_error`) is
   printed as `Request failed: 401 ...` but the process **exits 0**. Automation cannot
   distinguish a failed run from a successful one. SPEC error table
   (`packages/agent-cli/docs/SPEC.md:1569`) promises exit 1 for "Network or auth failure
   during model call".
2. The SPEC contradicts itself: §Exit Codes (SPEC.md:941) declares only `0 | 1`, while the
   error-handling table (SPEC.md:1565-1574) promises `process.exit(3)` for provider config
   errors in print mode. `grep -rn "exit(3)"` finds no such path in agent-cli or
   agent-transport — the exit-3 row describes code that does not exist.

Root cause of (1): `execution-round-streaming.ts:120` (agent-core) catches the provider
error and converts it into a normal assistant message (`addAssistantMessage('Request failed:
...', { providerError: true })`), then returns `null`. The session completes normally, the
headless runner's `complete` handler resolves exit 0. The runner's error path (exit non-zero,
`subtype: 'error'`, `error_code` classification via `resolveErrorCode`) already exists but is
never reached for provider call failures — a success-envelope masking instance
(common-mistakes #57).

## Architecture Review

### Affected Scope

- `packages/agent-core` / `src/services/` — execution result must carry a typed marker when
  the final round terminated with a provider error (`IExecutionResult` extension; the
  history message with `providerError: true` metadata already exists and stays — history is
  append-only)
- `packages/agent-transport` / `src/headless/headless-runner.ts` — map provider-error
  results to exit 1 + `subtype: 'error'` + `error_code` (text/json/stream-json formats)
- `packages/agent-framework` / `src/command-api/provider/provider-factory.ts` — typed
  `ProviderConfigError` thrown instead of bare `Error` (enables exit-code mapping without
  message matching)
- `packages/agent-cli` / `src/cli.ts` — print-mode dispatch catches `ProviderConfigError` →
  stderr + `process.exit(3)`; TTY/TUI flow unchanged (interactive setup)
- `packages/agent-cli` / `docs/SPEC.md` — single reconciled exit-code table; error-table rows
  match real code paths
- `packages/agent-core` / `docs/SPEC.md`, `packages/agent-transport` / `docs/SPEC.md` —
  result contract update

### Alternatives Considered

1. **Typed propagation: `IExecutionResult` gains a provider-error field; headless runner maps
   it to the existing error exit path (chosen).**
   - Pro: single source of truth — the execution layer states what happened, every transport
     decides presentation; TUI rendering (inline assistant message) is untouched because the
     history entry is unchanged; reuses the runner's existing `subtype`/`error_code`
     machinery.
   - Con: extends a core result type (one field) — requires core+transport SPEC sync.
2. **Headless runner inspects the last history message metadata (`providerError: true`).**
   - Pro: no core type change.
   - Con: transport reaching into history metadata is a layering smell; couples the runner to
     a message-construction detail of agent-core; breaks silently if the metadata key is
     renamed.
3. **Re-throw provider errors from the execution round (no message conversion).**
   - Pro: classic error flow.
   - Con: changes TUI behavior (today the failure renders inline and the session stays
     usable); risks regressing interactive UX and violates the existing round-termination
     design ("provider errors terminate the round, not the process").

### Decision

Alternative 1, plus exit-code table reconciliation implementing the promised
exit 3: `0` success/interrupted · `1` execution errors (argument parse, provider API,
user-local command, org policy) · `3` provider configuration error at print-mode session
start. Rationale for keeping 3: automation must distinguish "reconfigure, do not retry"
(config) from "retry may help" (runtime) — and the SPEC error table already promises this
distinction; spec-first means making the code conform after reconciling the table. The
`ProviderConfigError` class replaces message matching per code-quality rules.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — 출력 포맷 전수(text/json/stream-json/--bare): 모두 동일
      complete-핸들러 경로로 exit 0 — 세 포맷 모두 본 수정의 단일 매핑 지점(runner)을 공유.
      TUI는 history 렌더 경로라 영향 없음
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

_Mechanism correction during implementation (within the approved Decision): code reading
revealed `IExecutionResult` already carries typed `success: boolean` + `error?: Error`
fields, and `robotaRun` (`robota-execution.ts:81`) already throws failed results
(`!result.success && result.error`), which propagates session → framework `error` event →
the headless runner's existing `onError` exit path. The masking bug is solely that
`buildFinalResult` (`execution-service-helpers.ts:163`) computes `success:
!!lastAssistantMessage`, so the round's own "Request failed:" assistant message counts as
success. Therefore no new result field and no runner complete-mapping are needed — adding
them would duplicate an existing typed channel as dead code. The single-source-of-truth
intent of Alternative 1 is unchanged: the execution layer states what happened via its
existing typed fields; every transport decides presentation via the existing error event._

1. `agent-core`: `buildFinalResult` marks the result failed (`success: false`, `error`
   carrying the failure message) when the final assistant message has `providerError: true`
   metadata (set by the provider-error round branch). History append behavior unchanged.
   `robotaRun`'s existing failed-result throw then propagates it — no new field.
2. `agent-transport` headless runner: the existing `onError` handlers already produce
   `subtype: 'error'` + `error_code` (json/stream) and exit 1; gap to close: the text-format
   `onError` writes nothing — add the error message to stderr before resolving 1.
3. `agent-framework`: `readProviderSettings` throws `ProviderConfigError extends Error`
   (exported, typed); `agent-command` `ensureProviderConfig` throws the same class (it
   depends on agent-framework). `agent-cli` print-mode dispatch catches it → stderr message
   (existing guidance text) + exit 3. Interactive TTY flow unchanged.
4. `agent-cli` SPEC: one §Exit Codes table (`0/1/3` with meanings above); error-handling
   table rows updated to match real paths; the fictional rows removed.

## Affected Files

- `packages/agent-core/src/services/execution-round-streaming.ts`
- `packages/agent-core/src/services/execution-service.ts` (result assembly)
- `packages/agent-core/src/interfaces/` (IExecutionResult SSOT)
- `packages/agent-core/docs/SPEC.md`
- `packages/agent-transport/src/headless/headless-runner.ts`
- `packages/agent-transport/src/headless/__tests__/`
- `packages/agent-transport/docs/SPEC.md`
- `packages/agent-framework/src/command-api/provider/provider-factory.ts`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: unit (agent-core) — provider throws during round → execution result carries the
      typed provider-error field; history gains exactly one `Request failed:` assistant
      message (append-only preserved)
- [ ] TC-02: integration (agent-transport) — headless run with a stub provider throwing 401 →
      runner exit code 1; json format output has `subtype: "error"` and
      `error_code: "api_error"`; text format writes the failure to output
- [ ] TC-03: integration (agent-cli) — print mode with no provider configuration →
      stderr contains "No provider configuration found" and exit code 3
      (`ProviderConfigError` mapping)
- [ ] TC-04: unit — `ProviderConfigError` is exported and `readProviderSettings` throws it
      (instanceof assertion, no message matching)
- [ ] TC-05: regression — TUI history rendering tests unchanged/green (provider failure still
      renders as inline assistant message)
- [ ] TC-06: `packages/agent-cli/docs/SPEC.md` contains exactly one exit-code table listing
      0/1/3, and every error-table row names an existing code path

## Test Plan

Derived strategy (BEHAVIOR + cli/typescript): unit + integration via vitest.

| TC-ID | Test Type   | Tool / Approach                                                    | Notes                            |
| ----- | ----------- | ------------------------------------------------------------------ | -------------------------------- |
| TC-01 | unit        | vitest — agent-core execution service with throwing stub provider  |                                  |
| TC-02 | integration | vitest — headless runner + stub provider, assert exit/subtype/code |                                  |
| TC-03 | integration | vitest — startCli print path with empty settings, injected exit    |                                  |
| TC-04 | unit        | vitest — instanceof ProviderConfigError                            |                                  |
| TC-05 | regression  | vitest — existing TUI/history suites                               | no new tests; suites stay green  |
| TC-06 | manual      | SPEC.md diff review                                                | doc change — reviewed in PR diff |

## Tasks

- [x] `.agents/tasks/CLI-064.md` — 생성 완료 (T1~T7, TC-01~TC-06 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present
- Problem: concrete symptom (`robota -p "hi"` with invalid API key → HTTP 401 printed but exit 0; `grep -rn "exit(3)"` finds no code path) with reproduction condition (npm-installed 3.0.0-beta.73, real provider, 2026-06-11); no TBD/TODO or vague single-sentence description
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (output-format sweep text/json/stream-json/--bare, all share runner complete-handler path; TUI unaffected)
- Alternatives Considered: 3 entries, each with explicit pro and con
- Decision: references the driving trade-off (typed propagation keeps execution layer as single source of truth vs. transport layering smell vs. TUI regression; exit 3 retained to distinguish reconfigure vs. retry)
- Completion Criteria: 6 items, all prefixed TC-01..TC-06; each uses command/observable-behavior form; no banned vague phrasing ("works correctly", "no errors", "implemented", "displays correctly" absent)
- Test Plan: section present; 6 rows match 6 TC-N (count 6 = 6); every row has non-empty Test Type and Tool/Approach, no "TBD"; sole manual row TC-06 has Notes explaining why automated test is not applicable (doc change reviewed in PR diff)
- Structure: `## Tasks` present with placeholder (`.agents/tasks/CLI-064.md` — pending GATE-APPROVAL); `## Evidence Log` present and empty before this first GATE-WRITE run; no `## Status` or `## Classification` sections in body

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied "승인함" (2026-06-11) — matches the explicit-approval pattern ("승인"); not a clarifying-question answer, not silence
- Direct and unambiguous, directed at this spec: approval was given in response to a design summary ("## 설계안 요약 (승인 요청)") that explicitly enumerated CLI-064's design — typed provider-error field on IExecutionResult mapped by the headless runner to exit 1 + subtype error, reconciled single 0/1/3 exit-code table with exit 3 implemented via typed ProviderConfigError — flagged as "계약 결정 포함"; the request stated all four items (CLI-063/064/065/066) would proceed on approval and invited per-item objections; user approved all four with none excluded, so this is batch approval explicitly covering CLI-064, not approval of a different item
- Approval given AFTER spec content was authored and after GATE-WRITE passed (2026-06-11), so the approved content is the current content
- No Architecture Review or frontmatter type/tags modified after approval: `git diff` on the spec shows the only post-staging change is `status: draft → review-ready` (GATE-WRITE upgrade); `type: BEHAVIOR`, `tags: [cli, typescript]`, and the Architecture Review section are unchanged
- No NON-COMPLIANCE trigger: no implementation work started before this gate — `## Tasks` still shows placeholder (`.agents/tasks/CLI-064.md` — 미생성), no implementation commits exist for this item

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-12

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-064.md` exists with tasks T1–T7 (T1: agent-core provider-error result marking; T2: agent-transport headless runner error surfacing; T3: agent-cli print-mode exit 3; T4: agent-framework ProviderConfigError; T5: TUI regression; T6: SPEC exit-code table reconciliation; T7: build/test/PR wrap-up)
- Tasks file path recorded in `## Tasks` section of this spec: `- [x] .agents/tasks/CLI-064.md — 생성 완료 (T1~T7, TC-01~TC-06 매핑)`
- Tasks correspond to Completion Criteria — one task per TC-N: T1→TC-01, T2→TC-02, T3→TC-03, T4→TC-04, T5→TC-05, T6→TC-06 (all 6 TC-N covered; T7 is wrap-up, no TC mapping required)
- No NON-COMPLIANCE trigger: no implementation commits exist for this item — `git log` on affected paths (agent-core/src, agent-transport/src, agent-framework provider, agent-cli cli.ts) shows latest commit is CLI-063's PR #697 (unrelated files); `git status` shows no working-tree changes in affected packages
