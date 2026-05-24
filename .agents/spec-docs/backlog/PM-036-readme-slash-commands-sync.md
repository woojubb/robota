---
status: review-ready
type: BEHAVIOR
tags: [documentation, cli, readme]
---

# PM-036: README 슬래시 커맨드 목록 실제 구현과 동기화

## Problem

`packages/agent-cli/README.md`의 슬래시 커맨드 목록이 실제 구현과 불일치한다. README에는 12개가 문서화되어 있지만 코드에는 10개 커맨드가 추가로 구현되어 있어 `/provider`, `/mode`, `/rewind`, `/settings`, `/memory` 등이 README에 없다.

재현 조건: `README.md` 슬래시 커맨드 섹션 확인 → `/mode`, `/provider`, `/rewind`, `/settings`, `/memory`, `/skills`, `/statusline`, `/background`, `/reset` 항목 없음. `robota` 실행 후 `/help` 입력 → 더 많은 커맨드 목록 표시.

## Architecture Review

### Affected Scope

- `packages/agent-cli/README.md` — 슬래시 커맨드 섹션 업데이트
- `packages/agent-command/src/` — 실제 구현된 커맨드 목록 확인 기준

### Alternatives Considered

- **Alt A (채택): README 슬래시 커맨드 섹션 수동 업데이트 + 카테고리 그룹핑** — Pro: 구조 개선 가능, 내부 커맨드 제외 결정을 명시적으로 할 수 있음. Con: 코드 변경 시 재동기화 필요.
- **Alt B: 자동 생성 스크립트로 README 커맨드 목록 생성** — Pro: 항상 최신 상태 유지. Con: PM-036 범위 초과, 빌드 파이프라인 추가 복잡성.

### Decision

Alt A 채택. 사용자가 직접 사용하는 커맨드를 카테고리별(대화/세션/설정/유틸리티)로 그룹핑. `/validate-session` 등 내부 커맨드는 제외.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — packages/agent-command/src/ 커맨드 파일 목록 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`README.md`의 슬래시 커맨드 섹션을 카테고리별로 재구성. 실제 `/help` 출력과 동일한 커맨드 목록으로 업데이트. `/validate-session` 등 내부 커맨드는 제외.

## Affected Files

- `packages/agent-cli/README.md`

## Completion Criteria

- [ ] TC-01: README 슬래시 커맨드 목록에 `/provider`, `/mode`, `/rewind`, `/settings`, `/memory`가 포함됨
- [ ] TC-02: README에 `/validate-session`이 포함되지 않음
- [ ] TC-03: README 커맨드 수가 `robota --help` 또는 `/help` 출력의 사용자 공개 커맨드 수와 일치함

## Test Plan

| TC-ID | Test Type | Tool / Approach                                     | Notes                                                           |
| ----- | --------- | --------------------------------------------------- | --------------------------------------------------------------- |
| TC-01 | unit      | grep — README.md contains /provider /mode /rewind   | Automated string presence check against README content          |
| TC-02 | unit      | grep — README.md does not contain /validate-session | Automated absence check; internal commands must be excluded     |
| TC-03 | manual    | README 커맨드 목록 vs `/help` 출력 비교             | `/help` 출력은 런타임 TUI 실행 필요 — 자동화로 정확한 대조 불가 |

## Tasks

- [ ] `.agents/tasks/PM-036.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid from the 11-prefix list; `tags: [documentation, cli, readme]` present.
- Problem section: Concrete symptom present (12 vs 10+10 command mismatch, specific commands named). Reproduction condition present (README check + `robota` `/help` steps). No "TBD", "TODO", or vague single-sentence descriptions.
- Architecture Review Checklist: All 4 items are `[x]`. Sibling scan item `[x]` with evidence ("packages/agent-command/src/ 커맨드 파일 목록 확인"). Alternatives Considered has 2 entries (Alt A, Alt B) each with explicit Pro/Con. Decision references trade-off (manual update vs. auto-generation build complexity).
- Completion Criteria: All 3 items carry TC-N prefix (TC-01, TC-02, TC-03). Each uses observable/command form. No forbidden language ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: Section present. 3 rows matching exactly 3 TC-N criteria (counts match). All rows have non-empty Test Type and Tool/Approach. TC-03 is "manual" with non-empty Notes explaining why automated test is not possible (runtime TUI required).
- Structure: `## Tasks` section present with placeholder entry. `## Evidence Log` section present and was empty before this entry. No `## Status` or `## Classification` sections in body.
