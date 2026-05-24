---
status: approved
type: BEHAVIOR
tags: [cli, telemetry, privacy]
---

# PM-030: opt-in 익명 텔레메트리 — 실제 사용 패턴 수집

## Problem

Robota CLI가 실제로 어떻게 사용되는지 알 방법이 없다. "가장 많이 쓰는 명령어", "평균 세션 길이", "가장 자주 실패하는 도구" 같은 데이터 없이는 무엇을 개선해야 할지 판단하기 어렵다.

재현 조건: 출시 후 사용 패턴 데이터 없음 → 개선 우선순위를 추측에 의존.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/telemetry.ts` — 텔레메트리 이벤트 수집
- `packages/agent-cli/src/startup/first-run.ts` — 첫 실행 시 동의 프롬프트

### Alternatives Considered

- **Alt A (채택): opt-in 방식 + 첫 실행 동의 프롬프트** — Pro: 투명성, Next.js/pnpm 등 표준 방식. Con: opt-in rate가 낮을 수 있음.
- **Alt B: opt-out 방식 (기본 활성화)** — Pro: 더 많은 데이터 수집. Con: 신뢰 손상, 개인정보 우려.

### Decision

Alt A 채택. 거절이 default(opt-in). `~/.robota/settings.json`의 `telemetry: true/false`에 저장. PII 절대 수집 금지(내용, 경로, 사용자명 제외).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — first-run.ts, settings.json 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

첫 실행 시 동의 프롬프트 표시. 동의 여부를 settings.json에 저장. 동의 시 session_start/end, tool_call, error, command_used 이벤트 전송. PII 없는 익명 이벤트만 수집.

## Affected Files

- `packages/agent-cli/src/startup/telemetry.ts`
- `packages/agent-cli/src/startup/first-run.ts`

## Completion Criteria

- [ ] TC-01: 첫 실행 시 텔레메트리 동의 프롬프트 표시
- [ ] TC-02: 동의 거절(N) → settings.json에 `telemetry: false` 저장, 이벤트 미전송
- [ ] TC-03: 동의(Y) → session_start 이벤트가 전송됨 (내용/경로 없는 익명 데이터)
- [ ] TC-04: `robota config set telemetry false` → 텔레메트리 즉시 비활성화

## Test Plan

| TC-ID | Test Type | Tool / Approach                     | Notes                                               |
| ----- | --------- | ----------------------------------- | --------------------------------------------------- |
| TC-01 | unit      | vitest — first-run telemetry prompt | Mock first-run state, verify prompt shown           |
| TC-02 | unit      | vitest — telemetry opt-out          | Mock N answer, verify settings.json telemetry=false |
| TC-03 | unit      | vitest — event send on opt-in       | Mock Y answer, spy on event send, verify payload    |
| TC-04 | unit      | vitest — config set telemetry false | Run config command, verify telemetry disabled       |

## Tasks

- [ ] `.agents/tasks/PM-030.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft`, `type: BEHAVIOR` (valid 11-prefix value), `tags: [cli, telemetry, privacy]` present — all PASS
- Problem section: concrete symptom ("가장 많이 쓰는 명령어", "평균 세션 길이", "가장 자주 실패하는 도구" 없음), reproduction condition ("출시 후 사용 패턴 데이터 없음 → 개선 우선순위를 추측에 의존") present, no TBD/TODO/vague single-sentence — PASS
- Architecture Review Checklist: all 4 items [x], sibling scan [x] with evidence ("first-run.ts, settings.json 구조 확인"), Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro/Con, Decision references opt-in vs. opt-out trade-off — all PASS
- Completion Criteria: 4 items (TC-01–TC-04), all have TC-N prefix, all use Observable behavior form, no vague language ("works correctly" etc.) — PASS
- Test Plan: section present, 4 rows matching 4 TC-Ns (counts match), all rows have non-empty Test Type ("unit") and Tool/Approach (vitest + description), no manual rows requiring Notes justification — PASS
- Structure: Tasks section present with placeholder, Evidence Log section present and empty prior to this entry, no `## Status` or `## Classification` sections in body — PASS
- TC-N count check: Completion Criteria = 4 (TC-01–TC-04), Test Plan rows = 4 — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: PM group (PM-023~037)
