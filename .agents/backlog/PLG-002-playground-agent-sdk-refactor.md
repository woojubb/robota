---
id: PLG-002
title: 'Playground agent-sdk 기반 리팩토링'
status: backlog
priority: medium
created: 2026-05-10
area: apps/agent-web, packages/agent-playground
---

## Background

현재 playground는 내부에 `PlaygroundExecutor`를 직접 구성하는 방식으로 동작한다.
`agent-cli`가 `agent-sdk + TUI` 조합인 것과 동일하게, playground는 `agent-sdk + WEB` 조합이어야 한다.

```
agent-sdk + TUI  = agent-cli   (CLI 패키지)
agent-sdk + WEB  = playground  (agent-web 앱)
```

## Problem

- `agent-playground` 패키지가 `PlaygroundExecutor`라는 SDK와 분리된 실행 계층을 직접 보유하고 있다.
- `agent-sdk`가 제공하는 `Robota`, `RobotaTeam` 등의 공개 API를 거치지 않고 내부 구현에 의존한다.
- CLI와 Web이 동일한 SDK 계층을 공유해야 SDK의 기능 추가/변경이 두 UI에 동시에 반영된다.

## Goal

- `agent-playground`가 `agent-sdk`의 공개 API만 사용하도록 리팩토링한다.
- `PlaygroundExecutor`를 SDK 계층으로 대체하거나 SDK 래퍼로 축소한다.
- playground 특화 기능(이벤트 캡처, 시각화용 히스토리)은 plugin/event 아키텍처로 SDK 위에 구현한다.

## Scope

- `packages/agent-playground/src/lib/playground/robota-executor.ts` — SDK 공개 API로 교체
- `packages/agent-playground/src/contexts/playground-context/` — SDK 기반 상태 관리
- `packages/agent-playground/src/components/playground/workflow-visualization/` — 이벤트 소스를 SDK 이벤트로 전환

## Test Plan

- [ ] `pnpm typecheck` — agent-playground가 agent-sdk 외부 API만 import하는지 확인
- [ ] `pnpm --filter agent-playground test` — 기존 테스트 통과
- [ ] `pnpm --filter agent-web build` — 프로덕션 빌드 성공
- [ ] `pnpm harness:verify -- --scope apps/agent-web` — 하네스 검증

## User Execution Test Scenarios

### Scenario 1: playground에서 대화 후 workflow 시각화 동작 확인

**Prerequisites:**

- `pnpm --filter agent-web build && pnpm --filter agent-web start`
- `pnpm --filter agent-server dev`
- API 키 설정 완료

**Steps:**

1. http://localhost:3000/playground 접속
2. 모델/프로바이더 선택
3. "안녕하세요" 메시지 전송
4. Workflow 패널에서 노드 확인

**Expected:**

- Chat 패널에 AI 응답 표시
- Workflow 패널에 UserMessage → AssistantResponse 노드 렌더링

**Evidence:** (구현 후 기록)
