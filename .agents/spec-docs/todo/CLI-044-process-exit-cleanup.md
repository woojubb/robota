---
status: approved
type: BEHAVIOR
tags: [cli, lifecycle]
---

# CLI-044: cli.ts TUI 종료 후 process.exit 비동기 리소스 정리

## Problem

`packages/agent-cli/src/cli.ts`에서 TUI 종료 후 `process.exit(0)`을 즉시 호출한다. 이는 이벤트 루프를 강제 종료하여 파일 I/O, 네트워크 소켓, 로그 플러시 같은 비동기 리소스 정리가 완료되지 않을 수 있다.

재현 조건: TUI 모드 세션 종료 후 process exit 호출 → 진행 중인 비동기 I/O 강제 중단 가능.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/cli.ts` — process.exit(0) 제거 또는 shutdown 완료 후 호출로 변경

### Alternatives Considered

- **Alt A (채택): process.exit 제거 — Node.js 이벤트 루프 자연 종료에 맡김** — Pro: 비동기 리소스가 자연스럽게 정리됨, 구현 단순. Con: 이벤트 루프가 비워지지 않는 경우 프로세스가 종료되지 않을 수 있음.
- **Alt B: runtime.shutdown() 완료 후 process.exit 호출** — Pro: 명시적 정리 + 확실한 종료. Con: shutdown API가 아직 없으면 추가 작업 필요.

### Decision

Alt A 채택. `process.exit(0)` 제거 후 Node.js 이벤트 루프 자연 종료에 맡기는 것이 가장 단순하고 안전. Ink TUI가 종료되면 이벤트 루프가 자연히 비워진다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — cli.ts 종료 흐름 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`cli.ts`에서 `process.exit(0)` 호출 제거. TUI 완료 후 함수가 자연 종료되어 Node.js 이벤트 루프가 비워지면 프로세스가 자동 종료됨.

## Affected Files

- `packages/agent-cli/src/cli.ts`

## Completion Criteria

- [ ] TC-01: TUI 세션 정상 종료 후 process.exit 없이 프로세스가 종료됨
- [ ] TC-02: TUI 종료 후 파일 I/O 및 로그 플러시가 완료됨 (강제 중단 없음)
- [ ] TC-03: 기존 동작(세션 종료 후 프로세스 종료) 유지

## Test Plan

| TC-ID | Test Type | Tool / Approach                     | Notes                                           |
| ----- | --------- | ----------------------------------- | ----------------------------------------------- |
| TC-01 | unit      | vitest — cli.ts exit flow mock      | Verify process.exit not called after TUI end    |
| TC-02 | unit      | vitest — async resource cleanup spy | Verify no forced termination of pending I/O     |
| TC-03 | e2e       | vitest + child_process.spawn        | Spawn CLI, verify process exits after TUI close |

## Tasks

- [ ] `.agents/tasks/CLI-044.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is a valid type from the 11-prefix list; `tags: [cli, lifecycle]` present.
- Problem section: Concrete symptom identified (`process.exit(0)` in `packages/agent-cli/src/cli.ts` after TUI close); reproduction condition stated ("TUI 모드 세션 종료 후 process exit 호출"); no TBD/TODO/vague language found.
- Architecture Review Checklist: All 4 items are `[x]`; sibling scan `[x]` with evidence "cli.ts 종료 흐름 확인"; Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro/Con; Decision references the simplicity/safety trade-off driving the choice.
- Completion Criteria: 3 items, all prefixed TC-01/TC-02/TC-03; all use observable behavior form; no forbidden vague language found.
- Test Plan: Section present; 3 rows matching TC-01, TC-02, TC-03 (count matches Completion Criteria); all rows have non-empty Test Type and Tool/Approach; no "manual" rows requiring Notes justification.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections found in body.
- TC-N count check: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 (TC-01, TC-02, TC-03) — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)
