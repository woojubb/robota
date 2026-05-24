---
status: review-ready
type: SCREEN
tags: [docs, marketing, readme]
---

# PM-031: README 데모 GIF/스크린샷 추가

## Problem

README에 TUI가 어떻게 생겼는지 이미지가 없다. Aider, Claude Code 등 경쟁 도구는 모두 데모 GIF를 README 상단에 보유한다. 텍스트만으로는 처음 보는 개발자가 도구의 모습을 알 수 없다.

재현 조건: `packages/agent-cli/README.md` 확인 → 설치 섹션 아래에 데모 이미지 없음.

## Architecture Review

### Affected Scope

- `packages/agent-cli/README.md` — 데모 GIF 삽입
- `packages/agent-cli/docs/demo.gif` — 데모 GIF 파일

### Alternatives Considered

- **Alt A (채택): asciinema + agg로 GIF 생성 후 README에 삽입** — Pro: 실제 터미널 동작을 GIF로 표현, 5MB 이하 가능. Con: 녹화 환경 준비 필요.
- **Alt B: 스크린샷(PNG) 삽입** — Pro: 파일 크기 작음. Con: 동적 동작 표현 불가, 경쟁 도구 대비 임팩트 낮음.

### Decision

Alt A 채택. `asciinema rec` + `agg` 도구로 TUI 세션 녹화. 2분 이내 시나리오: 파일 읽기 + 코드 설명. GIF를 README 설치 섹션 아래에 삽입.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — README.md 현재 구조 및 assets 디렉토리 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`asciinema rec demo.cast` + `agg demo.cast demo.gif`로 TUI 세션 녹화. README 설치 섹션 아래에 `![Demo](docs/demo.gif)` 삽입. GIF 5MB 이하 유지.

## Affected Files

- `packages/agent-cli/README.md`
- `packages/agent-cli/docs/demo.gif`

## Completion Criteria

- [ ] TC-01: README 설치 섹션 아래에 데모 GIF 또는 이미지가 표시됨
- [ ] TC-02: GIF 파일 크기 5MB 이하
- [ ] TC-03: GIF에 TUI 실행 후 AI가 파일을 읽고 응답하는 장면 포함

## Test Plan

| TC-ID | Test Type | Tool / Approach               | Notes                                                                      |
| ----- | --------- | ----------------------------- | -------------------------------------------------------------------------- |
| TC-01 | unit      | grep — README image tag check | Automated: grep README.md for img/gif reference after installation section |
| TC-02 | unit      | file size check — ls -lh      | Automated: verify demo.gif file size ≤ 5MB                                 |
| TC-03 | manual    | visual GIF review             | Content quality requires human review — no automated content check         |

## Tasks

- [ ] `.agents/tasks/PM-031.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft` confirmed, `type: SCREEN` is valid (in 11-prefix list), `tags: [docs, marketing, readme]` present.
- Problem section: concrete symptom present ("README에 TUI가 어떻게 생겼는지 이미지가 없다" + competitor comparison); reproduction condition present (`packages/agent-cli/README.md` 확인 → 설치 섹션 아래에 데모 이미지 없음); no TBD/TODO/vague single-sentence found.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan item `[x]` with explicit completion evidence ("README.md 현재 구조 및 assets 디렉토리 확인"); Alternatives Considered has 2 entries (Alt A, Alt B), each with Pro and Con; Decision references the trade-off (dynamic motion vs. static screenshot, competitor impact).
- Completion Criteria: 3 items total (TC-01, TC-02, TC-03), all have TC-N prefix; at least 1 criterion per distinct feature (image presence, file size, content quality); all use Observable behavior form; no vague language ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: `## Test Plan` section present; 3 rows match 3 TC-N items (count matches); all rows have non-empty Test Type and Tool/Approach, no TBD; TC-03 is manual with non-empty Notes explaining why automated test is not possible.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty (first GATE-WRITE run); no `## Status` or `## Classification` sections found in body.
- TC-N count: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 (TC-01, TC-02, TC-03). Counts match.
