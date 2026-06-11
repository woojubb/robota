---
status: done
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

- [x] TC-01: unit (agent-core) — provider throws during round → execution result carries the
      typed provider-error field; history gains exactly one `Request failed:` assistant
      message (append-only preserved)
- [x] TC-02: integration (agent-transport) — headless run with a stub provider throwing 401 →
      runner exit code 1; json format output has `subtype: "error"` and
      `error_code: "api_error"`; text format writes the failure to output
- [x] TC-03: integration (agent-cli) — print mode with no provider configuration →
      stderr contains "No provider configuration found" and exit code 3
      (`ProviderConfigError` mapping)
- [x] TC-04: unit — `ProviderConfigError` is exported and `readProviderSettings` throws it
      (instanceof assertion, no message matching)
- [x] TC-05: regression — TUI history rendering tests unchanged/green (provider failure still
      renders as inline assistant message)
- [x] TC-06: `packages/agent-cli/docs/SPEC.md` contains exactly one exit-code table listing
      0/1/3, and every error-table row names an existing code path

## Test Plan

Derived strategy (BEHAVIOR + cli/typescript): unit + integration via vitest.

| TC-ID | Test Type   | Tool / Approach                                                    | Notes                                                                                                                                                    |
| ----- | ----------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest — agent-core execution service with throwing stub provider  | Test: `packages/agent-core/src/services/execution-service-helpers.test.ts` > `buildFinalResult provider-error marking (CLI-064)`                         |
| TC-02 | integration | vitest — headless runner + stub provider, assert exit/subtype/code | Test: `packages/agent-transport/src/headless/__tests__/headless-provider-failure.integration.test.ts` > `headless provider failure exit codes (CLI-064)` |
| TC-03 | integration | vitest — startCli print path with empty settings, injected exit    | Test: `packages/agent-cli/src/__tests__/cli-exit-codes.test.ts` > `provider config error exit codes (CLI-064)`                                           |
| TC-04 | unit        | vitest — instanceof ProviderConfigError                            | Test: `packages/agent-framework/src/command-api/provider/__tests__/provider-factory.test.ts` > `readProviderSettings error typing (CLI-064)`             |
| TC-05 | regression  | vitest — existing TUI/history suites                               | No new tests; existing suites under `packages/agent-transport/src/tui` (46 files / 377 tests) green                                                      |
| TC-06 | manual      | SPEC.md diff review                                                | Test skipped: doc-accuracy criterion — verified by reading `packages/agent-cli/docs/SPEC.md` tables against code paths (no automated test possible)      |

## Tasks

- [x] `.agents/tasks/completed/CLI-064.md` — 완료 후 아카이브 (T1~T7 전체 `[x]`, TC-01~TC-06 매핑)

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

### [GATE-VERIFY] — ✅ PASS | 2026-06-12

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/CLI-064.md` shows T1–T7 all `[x]`; no blocked or pending tasks
- Build passes: `pnpm --filter "@robota-sdk/agent-cli..." --filter "@robota-sdk/agent-transport..." build` → exit 0 (all affected packages + dependencies)
- Tests pass: `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-command --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-cli test` → exit 0 — agent-core 705/705, agent-session 60/60, agent-framework 891/891, agent-command 168/168, agent-transport 463/463 (incl. TUI suites — TC-05 regression), agent-cli 119/119
- Named TC test files verified individually: `execution-service-helpers.test.ts` 3/3 (TC-01), `headless-provider-failure.integration.test.ts` 2/2 + `headless-runner.test.ts` in full run (TC-02), `cli-exit-codes.test.ts` 2/2 (TC-03), `provider-factory.test.ts` 1/1 (TC-04)
- Implementation present on branch `feat/cli-064-exit-code-contract` commit 9225cffab: `buildFinalResult` providerError marking (`execution-service-helpers.ts:136`), text-format stderr in `headless-runner.ts`, `ProviderConfigError` class (`provider-factory.ts:18`, exported via framework index) thrown at `readProviderSettings` and agent-command `provider-startup.ts`, print-mode exit 3 mapping (`cli.ts:139`), SPEC.md updates in agent-cli/agent-core/agent-transport
- Mechanism correction stays within approved Decision: `git diff` of pre-implementation todo/ version vs active/ version shows Architecture Review (Affected Scope, Alternatives, Decision, Checklist) byte-identical; only Solution steps + inline correction note, frontmatter status, Tasks checkbox, and Evidence Log changed. The correction reuses the existing typed `success`/`error` channel inside agent-core (metadata inspection in `buildFinalResult`, not in transport), so Alternative 1's layering (execution layer states what happened, transports decide presentation via the existing error event) is preserved — it does not regress to rejected Alternative 2
- Pre-existing test update is documented: `execution-service.test.ts` idle-timeout case had encoded the masking behavior (`success: true` on 'Request failed:') as expected; updated to the new contract with rationale in the implementation commit message

### [GATE-COMPLETE: TC-01] — ✅ verified | 2026-06-12

- Command: `npx vitest run src/services/execution-service-helpers.test.ts` (packages/agent-core)
- Output: `Test Files 1 passed (1), Tests 3 passed (3)` — exit 0
- Test reference: `packages/agent-core/src/services/execution-service-helpers.test.ts` > `buildFinalResult provider-error marking (CLI-064)`
- Mechanism note: per the documented correction, the "typed provider-error field" is the existing `success: false` + `error` channel set by `buildFinalResult` (`execution-service-helpers.ts:136` providerError metadata check) — no new field; history append-only asserted in the test

### [GATE-COMPLETE: TC-02] — ✅ verified | 2026-06-12

- Command: `npx vitest run src/headless/__tests__/headless-provider-failure.integration.test.ts src/headless/__tests__/headless-runner.test.ts` (packages/agent-transport)
- Output: `Test Files 2 passed (2), Tests 17 passed (17)` — exit 0
- Test reference: `packages/agent-transport/src/headless/__tests__/headless-provider-failure.integration.test.ts` > `headless provider failure exit codes (CLI-064)` (2 tests: exit 1 + json `subtype: "error"`/`error_code: "api_error"`, text stderr write)
- Mapping path is the existing error-event route (`robota-execution.ts:82` failed-result throw → session `error` → runner `onError` `headless-runner.ts:83` stderr) — within the approved Decision

### [GATE-COMPLETE: TC-03] — ✅ verified | 2026-06-12

- Command: `npx vitest run src/__tests__/cli-exit-codes.test.ts` (packages/agent-cli)
- Output: `Test Files 1 passed (1), Tests 2 passed (2)` — exit 0
- Test reference: `packages/agent-cli/src/__tests__/cli-exit-codes.test.ts` > `provider config error exit codes (CLI-064)`
- Code path confirmed: `cli.ts:139` `process.exit(error instanceof ProviderConfigError && args.printMode ? 3 : 1)`; user-execution evidence in `.agents/backlog/completed/CLI-064-exit-code-contract-violations.md` (real binary: no-config print → exit 3)

### [GATE-COMPLETE: TC-04] — ✅ verified | 2026-06-12

- Command: `npx vitest run src/command-api/provider/__tests__/provider-factory.test.ts` (packages/agent-framework)
- Output: `Test Files 1 passed (1), Tests 1 passed (1)` — exit 0
- Test reference: `packages/agent-framework/src/command-api/provider/__tests__/provider-factory.test.ts` > `readProviderSettings error typing (CLI-064)` (instanceof assertion)
- Export confirmed: `class ProviderConfigError extends Error` at `provider-factory.ts:18`, thrown at `provider-factory.ts:43` and agent-command `provider-startup.ts:86,99`

### [GATE-COMPLETE: TC-05] — ✅ verified | 2026-06-12

- Command: `npx vitest run src/tui` (packages/agent-transport)
- Output: `Test Files 46 passed (46), Tests 377 passed (377)` — exit 0 (includes `message-list-rendering.test.tsx`, `render-markdown.test.ts`, history rendering suites)
- No new tests — regression criterion; suites unchanged and green

### [GATE-COMPLETE: TC-06] — ❌ not met | 2026-06-12

- Verified: `packages/agent-cli/docs/SPEC.md` contains exactly one exit-code table listing 0/1/3 (§Exit Codes, line 946-950) — first half of criterion met
- Failed: error-table row "Org policy violation | Provider not in `orgPolicy.allowedProviders` | Written to stderr; `process.exit(1)` in `cli.ts` | 1" (SPEC.md:1590) names a code path that does not exist. `grep -rn -i "policy" packages/agent-cli/src --include="*.ts"` → zero hits outside tests; no `allowedProviders` startup check anywhere in agent-cli. Actual `allowedProviders` enforcement lives in `packages/agent-command/src/provider/provider-command-profile-operations.ts:45` (`/provider switch` → failed `ICommandResult`, no process exit) and `packages/agent-framework/src/interactive/interactive-session.ts:480` (hot-swap → failed command result). The row is a fictional path of exactly the kind Solution step 4 required removed ("the fictional rows removed"); it was carried over verbatim from the pre-CLI-064 table (confirmed via `git show 9225cffab~1`). The §Exit Codes table's code-1 meaning also lists "org policy violations" on the strength of this row
- All other error-table rows verified against real code: argument parse (`cli.ts:57`), provider config (`cli.ts:139`), provider API (`execution-service-helpers.ts:136` → `robota-execution.ts:82` → `headless-runner.ts:83`), user-local cmd (`cli.ts:106-107`), init cancel (`init-command.ts:97`)

### [GATE-COMPLETE] — ❌ FAIL | 2026-06-12

**Status remains:** verifying
**Failed criteria:**

- TC-06 "every error-table row names an existing code path": the Org-policy-violation row claims "Written to stderr; `process.exit(1)` in `cli.ts`" but no org-policy code exists in agent-cli (enforcement is failed command results in agent-command/agent-framework, which do not exit the process). Found vs. required: fictional handling path retained vs. all rows matching real paths.
  **Required action:** Fix the SPEC error table — either remove the Org-policy-violation row (and "org policy violations" from the code-1 meaning in §Exit Codes) or rewrite it to name the real enforcement path (failed `ICommandResult` from `provider-command-profile-operations.ts` / `interactive-session.ts`, with its actual exit behavior). Then re-run GATE-COMPLETE.

- TC-01..TC-05 verified and checked `[x]` with fresh test runs (entries above); TC-06 left unchecked. Test Plan updated with test references for all rows. Tasks file NOT archived (`.agents/tasks/CLI-064.md` remains) — archival happens only on PASS.

### [GATE-COMPLETE: TC-06] — ✅ verified | 2026-06-12

- Re-run after SPEC fix required by the previous FAIL entry. Action: read `packages/agent-cli/docs/SPEC.md` §Exit Codes (lines 941-956) and §Error Taxonomy (lines 1582-1595) and verified every row against code with grep
- Exactly one exit-code table listing 0/1/3: `grep -c "^| Code | Meaning"` → 1 (line 946); code-1 meaning no longer lists "org policy violations" (`grep -n "org policy\|orgPolicy"` in SPEC.md → only line 828 ICliSetup component description and line 1590 taxonomy row)
- Org-policy row now names the real enforcement path: failed command result in `packages/agent-command/src/provider/provider-command-profile-operations.ts:45-48` (`orgPolicy.allowedProviders` check → failed `ICommandResult`) or session-level rejection in `packages/agent-framework/src/interactive/interactive-session.ts:480-485` (hot-swap check); neither calls `process.exit` (grep confirmed zero hits); exit code column "—" matches "process keeps running"
- All other taxonomy rows re-confirmed against real code: argument parse (`cli.ts:57`), provider config (`ProviderConfigError` → `cli.ts:139` exit 3 print / 1 otherwise), provider API (`execution-service-helpers.ts:136` → `robota-execution.ts:82` → `headless-runner.ts:83`), user-local cmd (`cli.ts:106-107`), IME/CJK `uncaughtException` handler (`bin.ts:15-18` string-width signal, process continues), unhandled exception re-throw (`bin.ts` non-IME branch), init cancel (`init-command.ts:97` "Init cancelled.", normal return)
- Test Plan row: skip reason recorded — doc-accuracy criterion, verified by reading SPEC tables against code paths; no automated test possible

### [GATE-COMPLETE] — ✅ PASS | 2026-06-12

**Status upgrade:** verifying → done

- All 6 Completion Criteria checkboxes `[x]`: TC-01..TC-05 verified with fresh test runs in the previous gate run today (entries above, all green with exit 0); TC-06 verified in this re-run after the SPEC fix (entry above)
- Every TC-N has a `[GATE-COMPLETE: TC-N]` Evidence Log entry with command/action, observed output, and exit code where applicable
- Test Plan: all 6 rows carry a test reference (TC-01..TC-04 vitest file + describe name, TC-05 existing TUI suites 46 files/377 tests) or an explicit skip reason (TC-06 manual doc review — no automated test possible)
- Tasks file archived: `.agents/tasks/CLI-064.md` → `.agents/tasks/completed/CLI-064.md` (T1-T7 all `[x]`, 7/7); `## Tasks` section updated to the archived path
- No NON-COMPLIANCE: prior gates (WRITE, APPROVAL, IMPLEMENT, VERIFY) all have PASS entries with specific evidence
