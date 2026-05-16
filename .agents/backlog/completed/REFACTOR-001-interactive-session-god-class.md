---
title: 'REFACTOR-001: InteractiveSession God Class 분해'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-sdk
---

## Problem

`packages/agent-sdk/src/interactive/interactive-session.ts`가 1,578줄, private field 96개, public async 메서드 21개로 anti-monolith 규칙을 5× 초과한다. 스트리밍 누적, 도구 추적, 메시지 히스토리, 백그라운드 태스크 이벤트, 서브에이전트 생명주기, 컨텍스트 참조, 에디트 체크포인트, 스킬 실행, 세션 지속성, 자동 압축 조율을 단일 클래스에서 처리한다.

Rule violation: Anti-monolith (300줄 제한), Composition over integration.

Source: COMBINED-001 (SA-001, SD-001)

## Scope

### Step 1 — 협력 클래스 추출

이미 분리된 helper 파일들(`interactive-session-execution.ts`, `interactive-session-streaming.ts`, `interactive-session-init.ts`, `interactive-session-persistence.ts`)의 패턴을 강화해 다음을 추출한다:

- `InteractiveSessionBackgroundTaskAdapter` — 백그라운드 태스크 구독/이벤트 상태 (`backgroundTasks`, `backgroundTaskEvents`, `backgroundJobGroups`)
- `InteractiveSessionCommandRouter` — 스킬 명령 라우팅, command executor 위임
- `InteractiveSessionHistoryAdapter` — 히스토리 + 에디트 체크포인트 + 샌드박스 스냅샷

### Step 2 — InteractiveSession 본체 정리

추출 후 `InteractiveSession` 본체는 얇은 coordinator로 남긴다. 목표 줄 수: ≤ 400줄.

### Step 3 — 각 추출 파일 검증

각 새 파일이 300줄 이하임을 확인. `pnpm harness:scan` 통과.

## Test Plan

- `pnpm --filter @robota-sdk/agent-sdk test` — 전체 통과
- `pnpm typecheck` — 전체 통과
- `pnpm harness:scan` — 300줄 위반 없음
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 내부 리팩터링이며 외부 공개 API 시그니처를 변경하지 않는다. 사용자 관찰 가능한 동작 변화 없음. 검증은 Test Plan의 자동화 테스트로 충분하다.
