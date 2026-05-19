---
title: 'PLG-019: AssignTask 제거 — 서브에이전트는 Agent Command로만 구현'
status: todo
created: 2026-05-20
priority: high
urgency: now
area: packages/agent-playground, packages/agent-team
depends_on: []
---

## Background

현재 Playground에는 서브에이전트를 spawn하는 방법이 두 가지 존재한다:

1. **AssignTask** (`packages/agent-playground/src/tools/catalog.ts`) — `@robota-sdk/agent-team`의 `createAssignTaskRelayTool`을 래핑한 플레이그라운드 전용 relay tool
2. **Agent Command** (`/agent` command, `robota_command_agent` tool) — `@robota-sdk/agent-command`의 `createAgentCommandModule()`이 제공하는 모델 호출 가능 커맨드

두 방법이 병존하면 구현이 중복되고 DAG 시각화 로직에서도 `robota_command_agent`만 처리하도록 되어 있어 AssignTask가 사실상 dead code 상태다.

**결정**: AssignTask를 완전히 제거하고 Agent Command(`robota_command_agent`)만 사용한다.

## Goals

- AssignTask 관련 코드를 레포 전체에서 완전히 제거
- `@robota-sdk/agent-team` 패키지 의존성이 AssignTask 때문만이라면 해당 의존성도 제거
- `robota_command_agent` (Agent Command)로 병렬 서브에이전트 호출이 Playground에서 정상 동작함을 검증

## Scope

### 제거 대상

- `packages/agent-playground/src/tools/catalog.ts` — `ASSIGN_TASK_META`, `assignTask` ToolRegistry 항목 제거
- `packages/agent-playground/src/tools/catalog.ts` — `createAssignTaskRelayTool` import 및 `@robota-sdk/agent-team` import 제거
- `packages/agent-playground/package.json` — `@robota-sdk/agent-team` 의존성 확인 후 제거 (AssignTask 외 다른 용도가 없으면)
- 관련 타입/인터페이스/테스트 파일 정리

### 검증 항목

- [ ] AssignTask 관련 코드가 레포에 남아있지 않음 (`grep -r "assignTask\|AssignTask\|assign_task" --include="*.ts"`)
- [ ] `@robota-sdk/agent-team` import가 agent-playground에 남아있지 않음
- [ ] Playground에서 에이전트 생성 후 "병렬로 두 가지 작업을 동시에 처리해줘" 요청 시 `robota_command_agent` tool이 호출되어 DAG에 `agent_job_created`, `agent_job_completed` 노드가 정상 표시됨
- [ ] typecheck, lint, test 통과

## User Execution Test Scenarios

### Scenario 1: AssignTask 완전 제거 확인

1. Playground UI에서 Tools 패널 열기
2. AssignTask 툴이 목록에 없음을 확인
3. `grep -r "AssignTask" packages/agent-playground/src` 결과 없음 확인

### Scenario 2: Agent Command로 병렬 서브에이전트 실행

1. Playground에서 에이전트 생성
2. "현재 서울 시각과 뉴욕 시각을 동시에 두 개의 서브에이전트로 조회해줘" 입력
3. DAG에 `agent_job_created` 노드 2개, `agent_job_completed` 노드 2개가 표시됨을 확인
4. `window.__robota_dag.events` 콘솔 조회로 0 orphans, 0 duplicate edges 확인
