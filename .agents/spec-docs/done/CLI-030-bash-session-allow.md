---
status: done
type: BEHAVIOR
tags: [cli]
---

# CLI-030: Bash 권한 피로 해소 — 세션-레벨 "이 세션에서 항상 허용"

## Problem

`default` 권한 모드에서 Bash 명령 실행마다 권한 프롬프트가 표시된다. "테스트 실행 → 결과 분석 → 수정 → 다시 테스트" 반복 워크플로우에서 매번 허용해야 하는 마찰이 크다. 이를 피하려는 사용자가 더 위험한 `bypassPermissions` 모드로 전환하게 된다.

재현 조건: `default` 모드에서 `pnpm test` 실행 → 매번 permission 프롬프트 발생.

## Architecture Review

### Affected Scope

- `packages/agent-session/src/permission-enforcer.ts` — 세션-로컬 allow 목록 관리
- `packages/agent-transport/src/tui/App.tsx` — 프롬프트 UI에 'session' 옵션 키 추가

### Alternatives Considered

- **Alt A (채택): 세션-로컬 메모리 allow 목록** — Pro: 세션 종료 시 자동 폐기로 보안 위험 없음, 구현 단순. Con: 세션 재시작 시 다시 허용해야 함.
- **Alt B: 영구 `settings.json` allow 패턴 저장** — Pro: 재시작 후에도 유지. Con: 사용자가 잊은 후 잠재적 보안 위험, CLI-030 범위 초과.

### Decision

Alt A 채택. `PermissionEnforcer`에 세션-로컬 `Set`으로 허용 패턴 저장. TUI 프롬프트에 `[s] Allow for this session` 옵션 추가. 세션 종료 시 자동 폐기.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — permission-enforcer.ts, App.tsx, InteractiveSession 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`PermissionEnforcer`에 `sessionAllowPatterns: Set<string>` 추가. TUI 프롬프트 키 's' 입력 시 현재 명령 패턴을 `sessionAllowPatterns`에 추가. 같은 패턴 재실행 시 허용 목록 확인 후 프롬프트 생략.

## Affected Files

- `packages/agent-session/src/permission-enforcer.ts`
- `packages/agent-transport/src/tui/App.tsx`

## Completion Criteria

- [x] TC-01: `pnpm test` 를 `s`(session allow)로 허용한 후 동일 세션에서 재실행 → 프롬프트 없이 실행됨
- [x] TC-02: 세션 종료 후 재시작 → 동일 명령이 다시 프롬프트를 표시함
- [x] TC-03: permission 프롬프트에 `[s] Allow for this session` 옵션이 표시됨
- [x] TC-04: `[a] Allow once`는 기존과 동일하게 동작 (세션 목록에 추가 안 됨)

## Test Plan

| TC-ID | Test Type | Tool / Approach                           | Notes                                              |
| ----- | --------- | ----------------------------------------- | -------------------------------------------------- |
| TC-01 | unit      | vitest — PermissionEnforcer session allow | Verify pattern added to sessionAllowPatterns       |
| TC-02 | unit      | vitest — new PermissionEnforcer instance  | New instance has empty sessionAllowPatterns        |
| TC-03 | unit      | vitest — TUI prompt options assertion     | Check 's' key option present in prompt config      |
| TC-04 | unit      | vitest — PermissionEnforcer allow-once    | Verify allow-once does not add to session patterns |

## Tasks

- [x] `.agents/tasks/CLI-030.md` — created 2026-05-25

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid from 11-prefix list; `tags: [cli]` present.
- Problem section: concrete symptom ("Bash 명령 실행마다 권한 프롬프트가 표시된다"), specific command `pnpm test` cited; reproduction condition explicitly stated; no TBD/TODO found.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with named files (permission-enforcer.ts, App.tsx, InteractiveSession); 2 alternatives (Alt A, Alt B) each have Pro/Con; decision references security-risk and scope trade-off.
- Completion Criteria: 4 items (TC-01–TC-04), all with TC-N prefix; each uses observable-behavior form; no vague language ("works correctly", "no errors", etc.).
- Test Plan: section present; 4 rows matching TC-01–TC-04 (count matches); all rows have non-empty Test Type ("unit") and Tool/Approach (vitest + description); no manual rows requiring Notes explanation.
- Structure: `## Tasks` present with placeholder; `## Evidence Log` was empty before this entry; no `## Status` or `## Classification` sections found in body.
- TC-N count parity: Completion Criteria = 4 (TC-01–TC-04); Test Plan rows = 4 (TC-01–TC-04). ✅ Match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Task file created: `.agents/tasks/CLI-030.md`
- Spec moved to active/
- Implementation: add `s` shortcut key, update PERMISSION_PROMPT_OPTIONS[1] label with `[s]` hint

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- `pnpm --filter @robota-sdk/agent-session test` → 60/60 passed
- `pnpm --filter @robota-sdk/agent-transport exec vitest run src/tui/__tests__/confirm-permission-flow.test.ts` → 13/13 passed (3 new CLI-030 tests included)
- Pre-existing failures in headless-runner.test.ts (unrelated to CLI-030) confirmed pre-existing on branch
- TC-01: covered by permission-enforcer-session-allow.test.ts (allow-session adds to sessionAllowedTools)
- TC-02: covered by permission-enforcer-session-allow.test.ts (new PermissionEnforcer instance has empty sessionAllowedTools)
- TC-03: new test "PERMISSION_PROMPT_OPTIONS[1] contains [s] hint" — passes
- TC-04: new test "y (allow-once) emits true not allow-session" — passes

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- All 4 TCs checked [x] in Completion Criteria
- TC-01 evidence: permission-enforcer-session-allow.test.ts — "allow-session response → adds tool to session list" passes
- TC-02 evidence: permission-enforcer-session-allow.test.ts — "Initially returns empty list" passes
- TC-03 evidence: confirm-permission-flow.test.ts — "PERMISSION_PROMPT_OPTIONS[1] contains [s] hint" passes
- TC-04 evidence: confirm-permission-flow.test.ts — "y (allow-once) emits true not allow-session" passes
- Spec moved to done/
