---
status: review-ready
type: BEHAVIOR
tags: [cli, ux, help]
---

# PM-034: /help 커맨드에 각 커맨드 사용 예시 추가

## Problem

`/help` 출력에 설명만 있고 사용 예시가 없다. 처음 사용자가 `/compact`가 무엇을 하는지 알아도 어떻게 쓰는지 모른다. Claude Code는 각 커맨드에 예시를 제공한다.

재현 조건: TUI에서 `/help` 입력 → 커맨드 목록과 설명만 표시, 예시 없음.

## Architecture Review

### Affected Scope

- `packages/agent-command/src/` — `ICommand` 인터페이스에 `example` 필드 추가
- `packages/agent-command/src/help/help-command.ts` — example 출력 로직 추가

### Alternatives Considered

- **Alt A (채택): ICommand에 example 필드 추가 + /help 출력에 포함** — Pro: 구조적 확장, 각 커맨드가 자체 예시 관리. Con: 기존 모든 커맨드에 example 추가 필요.
- **Alt B: help-command.ts에 하드코딩된 예시 목록** — Pro: 빠른 구현. Con: 커맨드 구현과 예시가 분리되어 유지보수 어려움.

### Decision

Alt A 채택. `ICommand` 인터페이스에 `example?: string` 추가. `formatCommandHelpMessage`에서 example 있는 경우 "Example: ..." 형식으로 출력. 복잡한 커맨드(/compact, /context add, /provider switch)에 예시 필수.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — ICommand 인터페이스, 각 command-module.ts 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`ICommand` 인터페이스에 `example?: string` 추가. `/compact`, `/context add`, `/provider switch` 등 복잡한 커맨드에 example 추가. `formatCommandHelpMessage`에서 example 출력.

## Affected Files

- `packages/agent-command/src/types/command.ts`
- `packages/agent-command/src/help/help-command.ts`
- `packages/agent-command/src/commands/compact-command.ts`

## Completion Criteria

- [ ] TC-01: `/help` 출력에 `/compact`의 사용 예시가 포함됨
- [ ] TC-02: `/help` 출력에 `/provider switch`의 사용 예시가 포함됨
- [ ] TC-03: `example` 없는 커맨드는 예시 섹션 없이 기존과 동일하게 출력됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                       | Notes                                           |
| ----- | --------- | ------------------------------------- | ----------------------------------------------- |
| TC-01 | unit      | vitest — help output compact example  | Verify /compact output includes Example: line   |
| TC-02 | unit      | vitest — help output provider example | Verify /provider switch output includes example |
| TC-03 | unit      | vitest — no-example command output    | Command without example, verify no Example line |

## Tasks

- [ ] `.agents/tasks/PM-034.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft`, `type: BEHAVIOR` (valid from 11-prefix list), `tags: [cli, ux, help]` present.
- Problem section: concrete symptom (`/help` shows no usage examples), reproduction condition (TUI `/help` → no examples shown), no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with explicit evidence (ICommand interface + command-module.ts structure checked); 2 alternatives with pro/con each (Alt A, Alt B); decision references trade-off (Alt A wins for structural extensibility vs. Alt B's maintenance burden).
- Completion Criteria: 3 items (TC-01, TC-02, TC-03), all with TC-N prefix, all use observable behavior form, no vague language found.
- Test Plan: section present, 3 rows matching TC-01/TC-02/TC-03, all rows have non-empty Test Type (unit) and Tool/Approach (vitest + description), no manual rows requiring Notes.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` was empty before this entry; no `## Status` or `## Classification` body sections found.
- TC-N count match: Completion Criteria = 3 (TC-01, TC-02, TC-03), Test Plan rows = 3 — counts match.
