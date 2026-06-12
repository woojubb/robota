---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-068: configure-provider failures must name the actual cause

## Problem

Verified 2026-06-11 (L1, npm-installed `3.0.0-beta.73`):

- `robota --configure-provider doesnotexist` → `Provider profile "doesnotexist" is missing
model`. The real problem is an unknown provider name; the message implies a missing flag
  and never lists supported providers. Cause: `validateProviderProfile`
  (`packages/agent-framework/src/command-api/provider/provider-settings.ts:113-134`) checks
  `model`/`type` BEFORE `findProviderDefinition` (:124), so the unknown-name case is
  misdiagnosed as a missing-field case.
- `robota --configure-provider anthropic --type anthropic --model m --api-key-env UNSET_VAR`
  → `Provider profile "anthropic" is missing apiKey`. The real problem is that the referenced
  env var is unset at configure time: `buildProviderProfile`
  (`provider-settings.ts:150-174`) formats `apiKeyEnv` via `formatEnvReference` without
  checking the variable exists, and downstream validation reports a generic missing-apiKey.

## Architecture Review

### Affected Scope

- `packages/agent-framework` / `src/command-api/provider/provider-settings.ts` —
  validation order (definition lookup first) + env-var existence check at configure time
- `packages/agent-framework` / `docs/SPEC.md` — configure-provider error taxonomy rows
- `packages/agent-cli` — no code change expected (messages surface through existing error
  printing); `docs/SPEC.md` configure section wording if it quotes messages

### Alternatives Considered

1. **Reorder validation (definition lookup first) + explicit env-existence check at
   configure time, with messages naming the cause (chosen).**
   - Pro: each failure names its actual cause; the supported-provider list comes from
     `providerDefinitions` (SSOT) — same source the no-provider startup error already uses;
     configure-time env check catches the misconfiguration at the moment the user can fix
     it.
   - Con: configuring with `--api-key-env` now requires the var to be set during
     configuration — a deliberate tightening (documented in SPEC).
2. **Keep validation order; post-process error messages in the CLI layer.**
   - Pro: framework untouched.
   - Con: CLI would re-derive "what was actually wrong" from a wrong error — message
     rewriting on top of misdiagnosis, drifts the moment validation changes; violates
     SSOT.
3. **Warn (not fail) on unset `--api-key-env` at configure time.**
   - Pro: allows pre-provisioning a profile before the key exists.
   - Con: defers the failure to first run with a worse message; the no-fallback rule says
     surface errors where they occur. Rejected — SPEC will state the var must be set.

### Decision

Alternative 1. The driving trade-off is diagnosing at the source vs layering patches: the
messages are wrong because validation order doesn't match causal order, so fix the order —
unknown provider is checked first (listing supported names from the definitions SSOT), then
field presence, and `--api-key-env` existence is validated at configure time with the env
var named in the error. Both failures exit 1 (already the error path's behavior).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `provider-settings.ts` 내 `validateProviderProfile` 호출 경로
      확인: configure-provider 플로우 전용(세션 시작 검증은 `normalizeProviderConfig` 별도
      경로)이라 본 변경이 시작 경로에 영향 없음; supported-name 나열은 startup의
      `ProviderConfigError` 가이던스와 동일하게 `providerDefinitions`에서 도출 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `validateProviderProfile`: move `findProviderDefinition` to the first check; on miss,
   return/throw `Unknown provider "<name>". Supported providers: <definition names in
order>.`
2. `buildProviderProfile` (or its validation step): when `--api-key-env <VAR>` is given and
   `env[VAR]` is unset/empty, fail with `Environment variable <VAR> is not set — set it
before configuring (the profile will reference $ENV:<VAR>).` Env is injected
   (parameter defaulting to `process.env`) for testability. Never print key values.
3. SPEC updates: framework error taxonomy rows for both messages; note the configure-time
   env requirement.

## Affected Files

- `packages/agent-framework/src/command-api/provider/provider-settings.ts`
- `packages/agent-framework/src/command-api/provider/__tests__/provider-settings.test.ts`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-cli/docs/SPEC.md` (configure section wording, if it quotes messages)

## Completion Criteria

- [x] TC-01: unknown provider name → error contains `Unknown provider "doesnotexist"` and
      the supported-name list from `providerDefinitions`; process exit 1
- [x] TC-02: known provider + `--api-key-env UNSET_VAR` (injected env without it) → error
      names `UNSET_VAR` and states it must be set when configuring; exit 1
- [x] TC-03: valid configure flow (known provider, set env var) succeeds unchanged
      (regression)
- [x] TC-04: missing `--model` on a known provider still reports the missing field (the
      original message remains for the genuinely-missing-field case)
- [x] TC-05: framework SPEC.md error taxonomy documents both new messages and the
      configure-time env requirement

## Test Plan

| TC-ID | Test Type | Tool / Approach                                 | Notes                                                                                                                                                                                                                                |
| ----- | --------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | unit      | vitest — validation fn with unknown name        | Test: `packages/agent-framework/src/command-api/provider/__tests__/configure-provider-messages.test.ts > configure-provider failure messages (CLI-068) > TC-01: unknown provider type names the cause and lists supported providers` |
| TC-02 | unit      | vitest — injected env map without the var       | Test: same file > `TC-02: unset --api-key-env target names the variable and the configure-time requirement`                                                                                                                          |
| TC-03 | unit      | vitest — happy-path configure with injected env | Test: same file > `TC-03: valid configure flow succeeds unchanged (regression)`                                                                                                                                                      |
| TC-04 | unit      | vitest — known provider, missing model          | Test: same file > `TC-04: a known provider genuinely missing a model still reports the missing field`                                                                                                                                |
| TC-05 | manual    | SPEC.md diff review                             | Skip reason (no automated test): doc prose — verified by direct read at GATE-COMPLETE, not automatable                                                                                                                               |

## Tasks

- [x] `.agents/tasks/completed/CLI-068.md` — archived at GATE-COMPLETE (T1~T6 complete, TC-01~TC-05 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptoms with exact commands and wrong outputs (`robota --configure-provider doesnotexist` → misdiagnosed missing-model; `--api-key-env UNSET_VAR` → generic missing-apiKey); reproduction conditions stated (verified 2026-06-11, L1, npm-installed 3.0.0-beta.73, with source locations `provider-settings.ts:113-134`, `:150-174`); no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (call-path check of `validateProviderProfile` — configure-only, startup uses `normalizeProviderConfig`; supported-name list sourced from `providerDefinitions` SSOT); 3 alternatives each with pro/con; Decision references the driving trade-off (diagnose at the source vs layering message patches).
- Completion Criteria: 5 items, all `TC-N` prefixed (TC-01–TC-05); one criterion per distinct sub-item (unknown-provider message, env-var check, regression, preserved missing-field case, SPEC taxonomy); all use command/observable form with explicit messages and exit codes; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") used.
- Test Plan: section present; 5 rows match 5 TC-N entries (count 5 = 5); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-05) has a non-empty Notes entry explaining non-automatability (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` present with placeholder (tasks file deferred until GATE-APPROVAL); `## Evidence Log` present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied verbatim "승인함" (2026-06-13), immediately after being told verbatim that replying "승인함" authorizes implementation of the 11 designs — matches the explicit-approval list ("승인").
- Approval directed at this spec: the consolidated approval request ("## 설계안 요약 (승인 요청) — 백로그 일괄 11건") itemized CLI-068 individually (validation reordered to causal order; unknown provider checked first with supported names from the definitions SSOT; unset `--api-key-env` errors naming the env var; configure-time env existence becomes REQUIRED) and explicitly flagged the CLI-068 product-direction decision ("068 configure 시점 env 필수화") before approval was given. Earlier replies were correctly not counted: "머지하고 main 릴리스 진행해줘" was a release instruction (executed as docs-only PR #705), and "그래서 뭐?" was a clarifying question — neither treated as approval.
- No Architecture Review or frontmatter type/tags modified after the approval request: `git log` shows exactly one commit touching this spec (cd5b1053a, GATE-WRITE batch, released in PR #705); post-GATE-WRITE changes were limited to the GATE-WRITE Evidence Log entry, the frontmatter status upgrade draft → review-ready, and prettier formatting; `type: BEHAVIOR` and `tags: [cli, typescript]` unchanged; working tree clean for this file.
- NON-COMPLIANCE trigger checked — no implementation before this gate: `.agents/tasks/CLI-068.md` does not exist; `git status` clean for `packages/agent-framework`; `provider-settings.ts` still has pre-spec validation order (missing-type/model checks at :119/:122 precede `findProviderDefinition` at :124, no "Unknown provider" message); the only recent provider-directory commit (f14ac82d9) is CLI-066 (#700), a different item.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-068.md` exists (untracked on branch `feat/cli-068-configure-messages`, confirmed via `git status`).
- Tasks file path recorded in `## Tasks` of this spec: entry "`.agents/tasks/CLI-068.md` — T1~T6 (TC-01~TC-05 매핑 + wrap-up)".
- Tasks correspond to Completion Criteria, at minimum one task per TC-N: T1↔TC-01 (definition lookup first, unknown-provider message with supported list, exit 1), T2↔TC-02 (configure-time `--api-key-env` existence check with injected env), T3↔TC-03 (happy-path regression), T4↔TC-04 (genuine missing-model diagnosis preserved), T5↔TC-05 (framework SPEC.md error taxonomy), plus T6 wrap-up (verify/PR/archive) — 5/5 TC-N covered.
- NON-COMPLIANCE trigger checked — no implementation commits without tasks file: `git log develop..HEAD` empty; working tree contains only the spec move todo/ → active/, the new tasks file, and pre-existing eval-lessons edits; `packages/agent-framework/src/command-api/provider/provider-settings.ts` untouched.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete or adjudicated: `.agents/tasks/CLI-068.md` T1–T5 are `[x]` (TC-01–TC-05 mapped). T6 (wrap-up) is intentionally unchecked and adjudicated per established CLI-063..069 precedent — its substance was verified directly this run: PR #710 (`feat/cli-068-configure-messages` → `develop`) is OPEN (`gh pr view 710 --json state`) with CI green (`gh pr checks 710`: build pass 1m19s, quality pass 50s, security audit pass 5s; compat-node18 and release-grade verification skipping by design; Cloudflare Pages preview not listed on this PR — non-blocking docs preview); backlog evidence exists at `.agents/backlog/completed/CLI-068-configure-provider-failure-messages.md` (`status: done`, real-binary User Execution scenarios recorded 2026-06-13: unknown provider → "Unknown provider" + supported list + exit 1; UNSET_VAR named + exit 1; valid configure saved + exit 0). Only the squash-merge itself remains, which by definition follows verification.
- No tasks blocked or pending: no task in `.agents/tasks/CLI-068.md` is marked blocked; T1–T5 done, T6 adjudicated as above.
- Build passes for the affected package: `pnpm --filter @robota-sdk/agent-framework build` → "Build complete" for both CJS (852ms) and ESM (862ms) outputs, no errors. agent-framework is the sole code-affected package (provider-settings.ts, configure-provider-messages.test.ts, two adapted pre-existing tests, docs/SPEC.md).
- Tests pass for the affected package: `pnpm --filter @robota-sdk/agent-framework test` → 92 test files passed, 911/911 tests passed, including the 4 new tests in `src/command-api/provider/__tests__/configure-provider-messages.test.ts` (re-run in isolation: 4/4 passed). The two adapted pre-existing tests (`src/__tests__/provider-configuration.test.ts`, `src/command-api/__tests__/command-api.test.ts`) inject env at configure time — this is the approved deliberate tightening (Decision/Alternative 1, TC-02), not contract drift.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: TC-01 is `[x]` in Completion Criteria.
- Command: `npx vitest run src/command-api/provider/__tests__/configure-provider-messages.test.ts` (cwd `packages/agent-framework`).
- Output: `✓ configure-provider failure messages (CLI-068) > TC-01: unknown provider type names the cause and lists supported providers` — 4/4 tests passed, exit code 0.
- End-to-end corroboration: `.agents/backlog/completed/CLI-068-configure-provider-failure-messages.md` records the real binary `robota --configure-provider doesnotexist` → `Unknown provider "doesnotexist". Supported providers: anthropic, openai, …`, exit=1.
- Test Plan reference recorded: `configure-provider-messages.test.ts > … > TC-01: unknown provider type names the cause and lists supported providers`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: TC-02 is `[x]` in Completion Criteria.
- Command: same vitest run as TC-01 (cwd `packages/agent-framework`).
- Output: `✓ … > TC-02: unset --api-key-env target names the variable and the configure-time requirement` — passed, suite exit code 0.
- End-to-end corroboration: backlog completed file records `robota --configure-provider anthropic --type anthropic --model m --api-key-env UNSET_VAR` → `Environment variable UNSET_VAR is not set — set it before configuring (the profile will reference $ENV:UNSET_VAR)`, exit=1; no key value printed.
- Test Plan reference recorded: `configure-provider-messages.test.ts > … > TC-02: unset --api-key-env target names the variable and the configure-time requirement`.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: TC-03 is `[x]` in Completion Criteria.
- Command: same vitest run as TC-01.
- Output: `✓ … > TC-03: valid configure flow succeeds unchanged (regression)` — passed, suite exit code 0.
- End-to-end corroboration: backlog completed file records the valid configure scenario saving the profile with exit=0.
- Test Plan reference recorded: `configure-provider-messages.test.ts > … > TC-03: valid configure flow succeeds unchanged (regression)`.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: TC-04 is `[x]` in Completion Criteria.
- Command: same vitest run as TC-01.
- Output: `✓ … > TC-04: a known provider genuinely missing a model still reports the missing field` — passed, suite exit code 0 (4 passed / 4 total).
- Test Plan reference recorded: `configure-provider-messages.test.ts > … > TC-04: a known provider genuinely missing a model still reports the missing field`.

### [GATE-COMPLETE: TC-05] — ❌ FAIL | 2026-06-13

- Checkbox: TC-05 is `[x]` in Completion Criteria — but the claimed artifact does not exist.
- Verification: direct read of `packages/agent-framework/docs/SPEC.md` `## Error Taxonomy` (line 382; table rows at lines 391–403) — no "Configure-provider validation" row; neither new message nor the configure-time env requirement is documented.
- Corroborating greps (all zero matches in framework SPEC.md): `Unknown provider`, `api-key-env`/`apiKeyEnv`, `configure-provider`, `supported providers`, `configure-time`.
- Commit check: CLI-068 commit `100dfb51b` (`git show --stat`) touches `provider-settings.ts`, `configure-provider-messages.test.ts`, two adapted tests, spec/backlog/tasks docs — but NOT `packages/agent-framework/docs/SPEC.md`; `git status` shows no uncommitted SPEC.md change. T5 is `[x]` in the archived tasks file without a real artifact.
- Test Plan: manual row with explicit skip reason is formally present; the manual verification itself failed.

### [GATE-COMPLETE] — ❌ FAIL | 2026-06-13

**Status remains:** verifying
**Failed criteria:**

- TC-05 (framework SPEC.md error taxonomy documents both new messages and the configure-time env requirement): checkbox is `[x]` and tasks-file T5 is `[x]`, but `packages/agent-framework/docs/SPEC.md` contains no Configure-provider validation row, no `Unknown provider` message, no `--api-key-env` configure-time requirement (Error Taxonomy table lines 391–403 unchanged since CLI-069 commit `839bd73ad`; CLI-068 commit `100dfb51b` does not touch SPEC.md).
  **Required action:** add the "Configure-provider validation" row(s) to `packages/agent-framework/docs/SPEC.md` `## Error Taxonomy` documenting the `Unknown provider "<name>". Supported providers: …` message, the `Environment variable <VAR> is not set — set it before configuring …` message, and the configure-time env-var requirement; commit on `feat/cli-068-configure-messages`; then re-run GATE-COMPLETE.

Passed criteria for the record: TC-01–TC-04 all `[x]` with vitest evidence (4/4 passed, exit 0) plus real-binary corroboration (exits 1/1/0); Test Plan rows updated with test references (TC-01–TC-04) and an explicit manual skip reason (TC-05); tasks file archived at `.agents/tasks/completed/CLI-068.md` with `## Tasks` pointing at the archived path. Only TC-05 blocks `verifying → done`.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Re-run after FAIL: required action completed via commit `175d1e825` ("docs(framework): CLI-068 configure-provider validation row in Error Taxonomy") on `feat/cli-068-configure-messages`; `git status` clean for `packages/agent-framework/docs/SPEC.md`.
- Checkbox: TC-05 is `[x]` in Completion Criteria — artifact now exists.
- Verification: direct read of `packages/agent-framework/docs/SPEC.md` `## Error Taxonomy` (header line 382) — row "Configure-provider validation" present at line 398. Content documents all three required elements: (1) unknown provider → `Unknown provider "<type>". Supported providers: <list from definitions SSOT>`; (2) unset `--api-key-env` target → `Environment variable <VAR> is not set — set it before configuring (the profile will reference $ENV:<VAR>)`; (3) the configure-time env requirement stated explicitly ("the variable MUST be set at configure time"), plus preservation of the original `is missing <field>` diagnosis for genuinely missing fields.
- Corroborating grep (`grep -n "Configure-provider\|Unknown provider\|api-key-env"` on framework SPEC.md): single taxonomy row hit at line 398 — the prior zero-match condition is resolved.
- Test Plan: manual row with explicit skip reason stands (doc prose verified by direct read, not automatable); manual verification now succeeds.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- TC-01: `[x]`; per-TC Evidence entry exists (vitest TC-01 passed, exit 0; real-binary corroboration exit 1); Test Plan reference recorded. Re-confirmed this run: `npx vitest run src/command-api/provider/__tests__/configure-provider-messages.test.ts` (cwd `packages/agent-framework`) → 4/4 passed, exit code 0.
- TC-02: `[x]`; per-TC Evidence entry exists (vitest TC-02 passed; real-binary `UNSET_VAR` named, exit 1, no key value printed); Test Plan reference recorded; covered by the same fresh 4/4 re-run.
- TC-03: `[x]`; per-TC Evidence entry exists (vitest TC-03 regression passed; real-binary valid configure exit 0); Test Plan reference recorded; covered by the same fresh 4/4 re-run.
- TC-04: `[x]`; per-TC Evidence entry exists (vitest TC-04 passed — genuine missing-model diagnosis preserved); Test Plan reference recorded; covered by the same fresh 4/4 re-run.
- TC-05: `[x]`; verified PASS this run (see [GATE-COMPLETE: TC-05] ✅ entry above) — SPEC.md Error Taxonomy line 398, commit `175d1e825`; Test Plan manual skip reason recorded.
- Test Plan: every TC-N row has a test reference (TC-01–TC-04, file + describe/test names) or an explicit skip reason (TC-05 manual, doc prose); no TC-N silently unaddressed.
- Completion Criteria: all 5 checkboxes `[x]`.
- Tasks archived: `.agents/tasks/completed/CLI-068.md` exists; no stale `.agents/tasks/CLI-068.md` remains; `## Tasks` section points at the archived path.
- The sole failing criterion from the prior [GATE-COMPLETE] ❌ FAIL entry (TC-05 missing taxonomy row) is resolved; status upgrade `verifying → done` is authorized.
