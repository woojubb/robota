---
status: review-ready
type: BEHAVIOR
tags: [cli, init]
---

# CLI-039: init-command.ts Claude Code 설정 파일 JSON 파싱 보호

## Problem

`packages/agent-cli/src/init/init-command.ts`에서 `.claude/settings.json`을 읽을 때 `JSON.parse`가 예외 처리 없이 직접 호출된다. 손상된 JSON 파일이 있으면 `SyntaxError`가 발생하고 `robota init`이 크래시한다.

재현 조건: `.claude/settings.json`에 유효하지 않은 JSON 작성 후 `robota init` 실행 → `SyntaxError: Unexpected token` 크래시.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/init/init-command.ts` — JSON 파싱 try/catch 보호 추가

### Alternatives Considered

- **Alt A (채택): try/catch로 감싸고 파싱 실패 시 null 반환 + 사용자 안내 메시지** — Pro: 손상 파일이 있어도 init이 진행됨, 사용자가 상황을 인지 가능. Con: 마이그레이션 데이터가 유실될 수 있음 (의도된 동작).
- **Alt B: 파싱 실패 시 에러와 함께 종료** — Pro: 명확한 실패. Con: 손상된 설정 파일 하나가 전체 init을 막음, UX 저해.

### Decision

Alt A 채택. `null` 반환 시 마이그레이션을 건너뛰고 "settings file could not be parsed — skipping migration" 안내. 손상 파일이 전체 init 흐름을 막지 않도록 함.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — init-command.ts 전체 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`readClaudeSettings()` 헬퍼를 try/catch로 감싸도록 수정. 파싱 실패 시 `null` 반환. 호출부에서 `null`이면 안내 메시지 출력 후 마이그레이션 스텝 건너뜀.

## Affected Files

- `packages/agent-cli/src/init/init-command.ts`

## Completion Criteria

- [ ] TC-01: 손상된 `.claude/settings.json`으로 `robota init` 실행 → 크래시 없이 안내 메시지 출력 후 계속 진행
- [ ] TC-02: 파싱 실패 시 "settings file could not be parsed" 메시지 출력
- [ ] TC-03: 정상 JSON 파일에서는 마이그레이션이 기존과 동일하게 동작

## Test Plan

| TC-ID | Test Type | Tool / Approach                      | Notes                                           |
| ----- | --------- | ------------------------------------ | ----------------------------------------------- |
| TC-01 | unit      | vitest — init-command malformed JSON | Mock readFileSync with invalid JSON, no throw   |
| TC-02 | unit      | vitest — warning message assertion   | Verify "could not be parsed" message emitted    |
| TC-03 | unit      | vitest — valid JSON parse path       | Mock valid settings.json, verify migration runs |

## Tasks

- [ ] `.agents/tasks/CLI-039.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft`, `type: BEHAVIOR` (valid from 11-prefix list), `tags: [cli, init]` present — all pass.
- Problem section: concrete symptom (unguarded `JSON.parse` → `SyntaxError` crash on `robota init`) and reproduction condition (invalid JSON in `.claude/settings.json` + run `robota init`) both present; no "TBD"/"TODO"/vague language found.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with explicit completion evidence; 2 alternatives (Alt A, Alt B) each with pro/con; decision references the trade-off (손상 파일이 전체 init 흐름을 막지 않도록 함).
- Completion Criteria: 3 items (TC-01, TC-02, TC-03) all with TC-N prefix; observable behavior form; no vague language.
- Test Plan: section present; 3 rows matching TC-01–TC-03 (count matches); each row has non-empty Test Type (unit) and Tool/Approach (vitest with description); no manual rows requiring Notes.
- Tasks section: present with placeholder.
- Evidence Log: present and empty before this entry.
- No `## Status` or `## Classification` sections in body.
- TC-N count match: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 (TC-01, TC-02, TC-03) — exact match.
