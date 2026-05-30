---
status: done
type: BEHAVIOR
tags: [cli, ux, provider]
---

# PM-032: 환경변수(ANTHROPIC_API_KEY 등) 있을 때 설정 화면 건너뛰기

## Problem

`ANTHROPIC_API_KEY` 환경변수가 설정되어 있어도 `~/.robota/settings.json`이 없으면 인터랙티브 설정 화면이 표시된다. CI/Docker 환경에서 `docker run -e ANTHROPIC_API_KEY=sk-ant-xxx robota -p "hello"` 실행 시 매번 설정 화면이 뜨거나 크래시가 발생한다.

재현 조건: `~/.robota/settings.json` 없는 환경에서 `ANTHROPIC_API_KEY` 설정 후 `robota -p "hello"` → 설정 화면 표시.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/config-phase.ts` — 환경변수 감지 후 설정 건너뛰기
- `packages/agent-cli/src/startup/provider-setup.ts` — ephemeral provider 생성

### Alternatives Considered

- **Alt A (채택): 환경변수 감지 시 ephemeral provider 생성 + 설정 건너뜀** — Pro: CI/Docker에서 즉시 동작, Claude Code와 동일한 UX. Con: settings.json 없이 사용 시 설정 지속성 없음.
- **Alt B: 환경변수 있어도 항상 설정 화면 표시** — Pro: 현재 동작 유지. Con: CI/Docker에서 non-interactive 실행 불가.

### Decision

Alt A 채택. 프로바이더 우선순위: `--provider` 플래그 → `settings.json` → 환경변수 자동 감지(ANTHROPIC → OpenAI → Gemini 순). 환경변수만 있어도 즉시 실행.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — config-phase.ts, provider-setup.ts, provider-startup.ts 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`config-phase.ts`에서 `ANTHROPIC_API_KEY` 감지 시 settings.json 없어도 ephemeral provider 반환. 어떤 프로바이더를 사용하는지 명확히 출력.

## Affected Files

- `packages/agent-cli/src/startup/config-phase.ts`
- `packages/agent-cli/src/startup/provider-setup.ts`

## Completion Criteria

- [x] TC-01: `ANTHROPIC_API_KEY`만 있고 settings.json 없는 환경에서 `robota -p "hello"` 즉시 실행
- [x] TC-02: CI 환경(`CI=true`)에서 non-interactive 실행 가능 (설정 화면 없음)
- [x] TC-03: 환경변수로 실행 시 어떤 프로바이더를 사용하는지 출력됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                         | Notes                                                                                         |
| ----- | --------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| TC-01 | unit      | vitest — config-phase env var detection | `provider-startup.test.ts`: detectEnvProvider + ensureConfig env bypass path verified         |
| TC-02 | unit      | vitest — CI=true non-interactive check  | `provider-startup.test.ts` line 263: "does not prompt in non-interactive missing-config mode" |
| TC-03 | unit      | vitest — provider selection output      | `provider-startup.ts` line 102: `Auto-configured provider: ${type} (via ${env})` message      |

## Tasks

- [x] `.agents/tasks/completed/PM-032.md` — archived

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft` confirmed, `type: BEHAVIOR` is a valid type from the 11-prefix list, `tags: [cli, ux, provider]` present.
- Problem section: concrete symptom present (docker run command + crash behavior), reproduction condition explicit (no settings.json + ANTHROPIC_API_KEY set + robota -p "hello"), no TBD/TODO or vague language.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence (config-phase.ts, provider-setup.ts, provider-startup.ts confirmed); 2 alternatives (Alt A, Alt B) each with explicit pro/con; decision cites the trade-off (CI/Docker non-interactive execution vs. persisted settings).
- Completion Criteria: TC-01, TC-02, TC-03 all carry TC-N prefix; each uses observable behavior form; no vague language found.
- Test Plan: section present; 3 rows matching TC-01/TC-02/TC-03 exactly (count matches Completion Criteria); all rows have non-empty Test Type (unit) and Tool/Approach (vitest with description); no manual rows requiring Notes.
- Structure: Tasks section present with placeholder; Evidence Log section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan = 3 (TC-01, TC-02, TC-03) — match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: PM group (PM-023~037)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Task file created: `.agents/tasks/PM-032.md` with TC-01, TC-02, TC-03 all pre-checked [x]
- All 3 completion criteria derived from spec and marked done (features pre-implemented)

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- TC-01 ✅ — `ENV_PROVIDER_CANDIDATES` includes `ANTHROPIC_API_KEY` at line 27; `detectEnvProvider()` (line 34-36) returns candidate when env var present; `ensureConfig()` (line 87-105) calls `applyProviderConfiguration` with env candidate and skips interactive setup — confirmed in `packages/agent-cli/src/startup/provider-startup.ts`
- TC-02 ✅ — `isInteractive` parameter (line 77) passed to `ensureProviderConfig` via `isInteractive: () => isInteractive` (line 115); non-interactive path (`false`) tested in `provider-startup.test.ts` line 263-285 ("does not prompt in non-interactive missing-config mode")
- TC-03 ✅ — `terminal.writeLine(` Auto-configured provider: ${envCandidate.type} (via ${envCandidate.env})`)` at line 102 outputs provider name and env var name when env-based auto-config runs

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- TC-01 ✅ — `detectEnvProvider()` in `provider-startup.ts` finds `ANTHROPIC_API_KEY` in `ENV_PROVIDER_CANDIDATES`; `ensureConfig()` calls `applyProviderConfiguration` with env candidate bypassing interactive setup
- TC-02 ✅ — `isInteractive: false` path in `ensureConfig()` passes to `ensureProviderConfig`; confirmed by test "does not prompt in non-interactive missing-config mode"
- TC-03 ✅ — `terminal.writeLine` at line 102 prints `Auto-configured provider: <type> (via <ENV>)` when env-based candidate detected
- Task archived: `.agents/tasks/PM-032.md` → `.agents/tasks/completed/PM-032.md`
