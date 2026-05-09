---
title: 'HOOK-001: agent-sdk 훅 시스템 Claude Code 호환성 감사'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: hooks
---

## Problem

agent-sdk의 훅 시스템(`packages/agent-core/src/hooks/`, `packages/agent-sessions/`)이 Claude Code 훅 스펙과 호환되게 설계되어 있다고 명시하지만, 실제로 Claude Code 기준으로 작성된 훅 스크립트를 연결했을 때 동작하지 않는 필드/동작 차이가 존재한다.

## Key Files Audited

- `packages/agent-core/src/hooks/types.ts` — IHookInput 타입 정의
- `packages/agent-core/src/hooks/hook-runner.ts` — runHooks() 실행 엔진
- `packages/agent-core/src/hooks/executors/command-executor.ts` — 쉘 커맨드 실행
- `packages/agent-sessions/src/session-run.ts` — UserPromptSubmit, Stop, StopFailure 발화
- `packages/agent-sessions/src/session-lifecycle.ts` — SessionStart, SessionEnd 발화
- `packages/agent-sessions/src/tool-hook-helpers.ts` — PreToolUse, PostToolUse 발화

## Compatibility Gaps Found

### [RESOLVED] HOOK-002: UserPromptSubmit stdin `prompt` 필드 — 갭 없음

CC 스펙: UserPromptSubmit stdin 필드명은 `prompt`.
SDK 현재: `prompt: rawInput ?? message` 이미 전달 중. **호환.**
초기 리서치에서 `user_prompt`로 잘못 인용. 공식 문서 재검증으로 종결.

### [HIGH] HOOK-003: PreToolUse 차단 시 CC와 다른 동작

CC 스펙: exit 2 → stderr를 사용자에게 표시, 도구 실행 자체가 취소됨.
SDK 현재: exit 2 → `{ success: false, error: "Blocked by hook" }`를 tool result로 반환. AI가 "도구가 실패했다"는 결과를 받음. 대화 흐름이 달라진다.

### [MEDIUM] HOOK-004: `permission_mode` 필드 미포함

CC 스펙: 모든 훅 stdin에 `permission_mode` 포함 (default, auto, bypassPermissions 등).
SDK 현재: `IHookInput`에 `permission_mode` 필드 없음.

### [MEDIUM] HOOK-005: 전체 훅 이벤트에서 `transcript_path` 미전달

CC 스펙: **모든** 훅 이벤트 stdin에 `transcript_path` 공통 필드로 포함.
SDK 현재: `IHookInput` 타입에는 있지만 어떤 발화 지점에서도 실제로 전달하지 않음.
초기 백로그에서 Stop/SessionEnd만 기술했으나 공식 문서 재검증 결과 전체 이벤트 대상.

### [MEDIUM] HOOK-006: stdout JSON 응답 포맷 미파싱

CC 스펙: 훅 stdout으로 `{ "decision": "block"|"allow", "reason": "...", "additionalContext": "..." }` JSON 반환 가능. Claude Code가 이를 파싱해 AI 컨텍스트에 주입.
SDK 현재: `runHooks()`가 stdout을 단순 문자열로 수집. JSON 파싱 없음. `additionalContext`로 컨텍스트 주입 기능 미구현.

### [MEDIUM] HOOK-007: CommandExecutor 기본 타임아웃 10s (CC는 600s)

CC 스펙: 기본 타임아웃 **600초 (10분)**.
SDK 현재: `DEFAULT_TIMEOUT_SECONDS = 10`. 타임아웃에 민감한 훅이 실패할 수 있음.
초기 백로그에서 60s로 잘못 기술. 공식 문서 재검증 결과 CC 기본값은 600s.

## Fix Backlog

- ~~HOOK-002~~: 갭 없음 — SDK가 이미 `prompt` 전달 중 (종결)
- HOOK-003: PreToolUse 차단 동작 CC 호환 방식으로 수정
- HOOK-004: `permission_mode` 필드 IHookInput에 추가
- HOOK-005: 전체 훅 이벤트에서 `transcript_path` 전달
- HOOK-006: stdout JSON 응답 파싱 추가 (`additionalContext`, `permissionDecision` 등)
- HOOK-007: CommandExecutor 기본 타임아웃 600s (10분)로 조정
