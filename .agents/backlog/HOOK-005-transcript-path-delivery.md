---
title: 'HOOK-005: 전체 훅 이벤트에서 transcript_path 미전달'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: hooks
depends_on: HOOK-001
---

## Problem

CC 스펙은 **모든 훅 이벤트**의 stdin JSON에 `transcript_path`(현재 세션 transcript 파일 경로)를 공통 필드로 포함한다.
훅 스크립트가 transcript를 읽어 세션 분석, 로그 수집 등에 사용하는 것이 CC의 일반적인 패턴이다.

SDK 현재 상태:

- `IHookInput` 타입에는 `transcript_path?: string` 필드 존재
- 그러나 실제로 어떤 이벤트 발화 지점에서도 이 필드를 설정하지 않음
- 결과: 모든 이벤트에서 `transcript_path`가 항상 `undefined`

**초기 백로그에서는 Stop/SessionEnd만 언급했으나 공식 문서 재검증 결과 모든 이벤트에서 제공해야 함.**

## Open Question (구현 전 확인 필요)

CC는 JSONL 형식 파일 절대경로를 `transcript_path`로 전달한다.
SDK에서 transcript 파일이 항상 생성되는지는 확인되지 않음:

- CLI + 세션 스토리지 활성화 시: `.robota/sessions/` 하위에 생성됨 (경로 전달 가능)
- 세션 스토리지 미설정 시(in-process, web 환경): 파일 없음 → `undefined` 생략 처리

**구현 전에 `Session`이 transcript 경로를 어떤 조건에서 알 수 있는지 `session-types.ts`, `session.ts` 확인 필요.**

## Required Change

### `packages/agent-sessions/src/session-lifecycle.ts`

`fireSessionStartHook()`, `fireSessionEndHook()`에서 `transcript_path` 전달.

### `packages/agent-sessions/src/session-run.ts`

`executeRun()`의 UserPromptSubmit, Stop, StopFailure 발화 지점에서 `transcript_path` 전달.

### `packages/agent-sessions/src/tool-hook-helpers.ts`

`buildHookInput()`에서 `transcript_path` 포함.

### 전달 경로 설계

세션이 transcript 경로를 알고 있어야 한다.
`IRunContext`에 `transcriptPath?: string` 추가하고 Session에서 주입하는 방식이 적합하다.
transcript 파일이 없는 경우(in-process, web 환경 등)는 `undefined`로 생략.

## Test Plan

- 각 이벤트 발화 시 stdin JSON에 `transcript_path` 포함 확인
- 경로가 실제 파일로 존재하는지 확인 (CLI 환경)
- transcript 미지원 환경에서는 `undefined`로 생략되는지 확인

## User Execution Test Scenarios

Not applicable — internal hook input field change.
