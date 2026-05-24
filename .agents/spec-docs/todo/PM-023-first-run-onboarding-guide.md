---
status: approved
type: BEHAVIOR
tags: [cli, ux, onboarding]
---

# PM-023: 첫 실행 온보딩 가이드 — "무엇을 먼저 물어볼까" 안내

## Problem

사용자가 `npx @robota-sdk/agent-cli`를 처음 실행하면 빈 프롬프트 앞에서 막힌다. "뭘 물어봐야 하지?"가 해결되지 않으면 도구를 닫는다. 첫 실행 경험을 안내하는 온보딩 배너와 예제 프롬프트가 없다.

재현 조건: `~/.robota/first_run` 파일 없는 첫 실행 → 온보딩 배너 없이 빈 프롬프트만 표시.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/first-run.ts` — 첫 실행 감지 + 배너 표시
- `packages/agent-transport-tui/src/` — 배너 렌더링

### Alternatives Considered

- **Alt A (채택): ~/.robota/first_run 파일로 첫 실행 감지 후 배너 표시** — Pro: 단순하고 확실한 감지, 배너 억제 가능. Con: 파일 삭제 시 반복 노출 가능.
- **Alt B: settings.json에 onboarding_shown: true 플래그** — Pro: 설정과 통합. Con: settings.json 구조 변경 필요.

### Decision

Alt A 채택. `~/.robota/first_run` 마커 파일로 첫 실행 감지. 배너 표시 후 마커 파일 생성. 프로젝트 타입(package.json, Cargo.toml, go.mod) 감지로 맞춤 프롬프트 제안.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — first-run.ts, startup 흐름 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`first-run.ts`에서 `~/.robota/first_run` 파일 확인. 없으면 온보딩 배너 표시 + 마커 파일 생성. 배너에 예제 프롬프트 4개 이상 포함. `/help` 명령 안내 포함.

## Affected Files

- `packages/agent-cli/src/startup/first-run.ts`
- `packages/agent-transport-tui/src/components/OnboardingBanner.tsx`

## Completion Criteria

- [ ] TC-01: `~/.robota/first_run` 없는 첫 실행 → 온보딩 배너 표시
- [ ] TC-02: 두 번째 실행(마커 파일 있음) → 배너 없음
- [ ] TC-03: 배너에 예제 프롬프트 4개 이상 포함
- [ ] TC-04: `/help`로 예제 프롬프트 10개 이상 확인 가능

## Test Plan

| TC-ID | Test Type | Tool / Approach                   | Notes                                         |
| ----- | --------- | --------------------------------- | --------------------------------------------- |
| TC-01 | unit      | vitest — first-run detection mock | Mock fs, no marker file → banner shown        |
| TC-02 | unit      | vitest — first-run detection mock | Mock fs, marker file present → no banner      |
| TC-03 | unit      | vitest — banner content assertion | Check banner text includes 4+ example prompts |
| TC-04 | unit      | vitest — help command output      | Verify /help returns 10+ example prompts      |

## Tasks

- [ ] `.agents/tasks/PM-023.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (from 11-prefix list); `tags: [cli, ux, onboarding]` present.
- Problem section: concrete symptom present ("빈 프롬프트 앞에서 막힌다"); reproduction condition present (`~/.robota/first_run` 파일 없는 첫 실행); no "TBD" or "TODO" found.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan item `[x]` with evidence ("first-run.ts, startup 흐름 확인"); 2 alternatives (Alt A, Alt B) each with Pro/Con; decision references the trade-off (simplicity vs. settings integration).
- Completion Criteria: 4 items (TC-01 through TC-04), all with TC-N prefix; observable behavior form used throughout; no vague language ("works correctly" etc.) found.
- Test Plan: section present; 4 rows matching 4 TC-N items (count matches); all rows have Test Type "unit" and vitest-based Tool/Approach; no manual rows requiring Notes justification.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` present and was empty before this entry; no `## Status` or `## Classification` body sections found.
- TC-N count: Completion Criteria = 4 (TC-01–TC-04); Test Plan rows = 4 — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: PM group (PM-023~037)
