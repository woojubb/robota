---
status: review-ready
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

- [ ] TC-01: unknown provider name → error contains `Unknown provider "doesnotexist"` and
      the supported-name list from `providerDefinitions`; process exit 1
- [ ] TC-02: known provider + `--api-key-env UNSET_VAR` (injected env without it) → error
      names `UNSET_VAR` and states it must be set when configuring; exit 1
- [ ] TC-03: valid configure flow (known provider, set env var) succeeds unchanged
      (regression)
- [ ] TC-04: missing `--model` on a known provider still reports the missing field (the
      original message remains for the genuinely-missing-field case)
- [ ] TC-05: framework SPEC.md error taxonomy documents both new messages and the
      configure-time env requirement

## Test Plan

| TC-ID | Test Type | Tool / Approach                                 | Notes                                                                 |
| ----- | --------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| TC-01 | unit      | vitest — validation fn with unknown name        | message content + supported list assertion                            |
| TC-02 | unit      | vitest — injected env map without the var       | env var named, no key value printed                                   |
| TC-03 | unit      | vitest — happy-path configure with injected env | regression                                                            |
| TC-04 | unit      | vitest — known provider, missing model          | original diagnosis preserved where correct                            |
| TC-05 | manual    | SPEC.md diff review                             | doc prose — verified by direct read at GATE-COMPLETE, not automatable |

## Tasks

- [ ] `.agents/tasks/CLI-068.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptoms with exact commands and wrong outputs (`robota --configure-provider doesnotexist` → misdiagnosed missing-model; `--api-key-env UNSET_VAR` → generic missing-apiKey); reproduction conditions stated (verified 2026-06-11, L1, npm-installed 3.0.0-beta.73, with source locations `provider-settings.ts:113-134`, `:150-174`); no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (call-path check of `validateProviderProfile` — configure-only, startup uses `normalizeProviderConfig`; supported-name list sourced from `providerDefinitions` SSOT); 3 alternatives each with pro/con; Decision references the driving trade-off (diagnose at the source vs layering message patches).
- Completion Criteria: 5 items, all `TC-N` prefixed (TC-01–TC-05); one criterion per distinct sub-item (unknown-provider message, env-var check, regression, preserved missing-field case, SPEC taxonomy); all use command/observable form with explicit messages and exit codes; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") used.
- Test Plan: section present; 5 rows match 5 TC-N entries (count 5 = 5); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-05) has a non-empty Notes entry explaining non-automatability (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` present with placeholder (tasks file deferred until GATE-APPROVAL); `## Evidence Log` present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.
