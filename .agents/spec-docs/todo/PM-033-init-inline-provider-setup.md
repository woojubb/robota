---
status: approved
type: FLOW
tags: [cli, ux, init]
---

# PM-033: robota init 완료 후 프로바이더 설정 인라인 연결

## Problem

`robota init` 완료 후 "Next steps: 2. Run `robota --configure`"를 안내하지만 많은 사용자가 Step 3로 바로 가서 "No provider configuration found" 오류를 만난다. init과 provider 설정 사이에 마찰이 있다.

재현 조건: `robota init` 실행 → 완료 메시지 → `robota` 실행 → "No provider configuration found" 오류.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/init/init-command.ts` — 완료 후 프로바이더 설정 프롬프트 추가

### Alternatives Considered

- **Alt A (채택): init 완료 후 "provider 설정하시겠습니까? [Y/n]" 프롬프트** — Pro: 연속 플로우로 마찰 제거. Con: 비인터랙티브 환경에서 처리 필요.
- **Alt B: init 완료 시 자동으로 provider 설정 플로우 진입** — Pro: 클릭 없이 자동 진행. Con: 의도치 않은 진입, `--no-configure` 플래그 필요성 증가.

### Decision

Alt A 채택. `robota init` 완료 후 Y/n 프롬프트로 provider 설정 선택. Y 시 `runProviderStartupSetup` 플로우 즉시 진행. 비인터랙티브 환경(`CI=true`, `--yes`)에서는 프롬프트 없이 Next steps만 출력.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — init-command.ts, provider-startup.ts 흐름 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`init-command.ts` 완료 후 `Would you like to set up a provider now? [Y/n]` 프롬프트 추가. Y 선택 시 `runProviderStartupSetup()` 호출. `CI=true` 또는 `--yes` 플래그 시 프롬프트 건너뜀.

## Affected Files

- `packages/agent-cli/src/init/init-command.ts`
- `packages/agent-cli/src/startup/provider-startup.ts`

## Completion Criteria

- [ ] TC-01: `robota init` 완료 후 프로바이더 설정 제안 프롬프트 표시
- [ ] TC-02: Y 선택 → API 키 입력 플로우 진입
- [ ] TC-03: `CI=true` 환경에서 `robota init` → 프롬프트 없이 Next steps만 출력
- [ ] TC-04: `robota init --yes` 실행 → 프롬프트 없이 완료

## Test Plan

| TC-ID | Test Type | Tool / Approach                    | Notes                                                |
| ----- | --------- | ---------------------------------- | ---------------------------------------------------- |
| TC-01 | unit      | vitest — init-command prompt mock  | Mock init completion, verify provider prompt shown   |
| TC-02 | unit      | vitest — Y answer → provider setup | Mock Y answer, verify runProviderStartupSetup called |
| TC-03 | unit      | vitest — CI=true non-interactive   | Mock CI=true, verify no prompt emitted               |
| TC-04 | unit      | vitest — --yes flag skips prompt   | Pass --yes flag, verify no prompt                    |

## Tasks

- [ ] `.agents/tasks/PM-033.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft` confirmed, `type: FLOW` is valid (in 11-prefix list), `tags: [cli, ux, init]` present.
- Problem section: concrete symptom present (`robota init` → `robota` → "No provider configuration found" error), reproduction condition present (specific command sequence), no TBD/TODO/vague single-sentence.
- Architecture Review Checklist: all 4 items are `[x]`. Sibling scan `[x]` with evidence ("init-command.ts, provider-startup.ts 흐름 확인"). Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro/Con. Decision references the trade-off (Y/n prompt vs. auto-enter, CI non-interactive handling).
- Completion Criteria: TC-01, TC-02, TC-03, TC-04 all have TC-N prefix. At least 1 criterion per distinct case. Each criterion uses Observable behavior form. No vague language found.
- Test Plan: `## Test Plan` section present. 4 TC-N rows matching 4 Completion Criteria (count matches). All rows have non-empty Test Type ("unit") and Tool/Approach (vitest with specific mock strategy). No "TBD" entries. No manual rows requiring Notes justification.
- Structure: `## Tasks` section present with placeholder. `## Evidence Log` section present and was empty before this entry. No `## Status` or `## Classification` sections found in body.
- TC-N count cross-check: Completion Criteria = 4 (TC-01 to TC-04), Test Plan rows = 4 — exact match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: PM group (PM-023~037)
