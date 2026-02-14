---
title: "Workflow DAG 개발 계획"
description: "Design-time DAG와 Runtime 실행을 분리한 대규모 워크플로 시스템 구현 계획"
---

# Workflow DAG 개발 계획

## 0) 패키지 네이밍/분리 전략 (중요)

### 결론
- 신규 패키지명은 **`dag`**를 권장한다.
- 예시: `@robota-sdk/dag`

### 이유 (`flow` 대비)
- `dag`는 엔진의 핵심 제약(비순환 그래프)을 이름 자체로 명확히 고정한다.
- `flow`는 의미가 넓어(대화 흐름, UI flow, 데이터 flow) 기존 `workflow`/`playground`와 경계가 흐려질 수 있다.
- Airflow 계열 개념(DAG, DAG Run, Task Instance)과 직접 매핑되어 문서/코드/운영 용어 일관성이 높다.

### 기존 `workflow` 패키지 처리 원칙
- 기존 `packages/workflow`는 **동결(freeze)** 하고 유지한다.
- 신규 DAG 개발은 **완전히 별도 패키지**에서 진행한다.
- 1차 목표는 “교체”가 아니라 “공존 + 점진 전환”이다.

---

## 1) 목표와 배경

현재 워크플로우는 단일 agent 흐름 중심으로 동작한다.  
다음 단계에서는 n8n/Airflow 스타일의 **다중 노드 DAG**를 지원하고, 아래 두 축을 명확히 분리한다.

- **Workflow Design 축**: DAG 정의(노드/엣지/입출력 계약) 작성/검증/버전관리
- **Workflow Execution 축**: DAG Run 생성, 스케줄링, 백그라운드 worker 실행, 상태 추적

핵심 방향:
- DAG는 정적 정의(불변 버전)로 관리
- 실행은 worker 기반 비동기 처리
- UI 시각화(Workflow Graph)와 실행 엔진(Runtime)을 분리

---

## 2) 범위 정의

### In Scope
- DAG Definition 모델 도입 (nodes, edges, I/O schema, defaults)
- DAG Validation 엔진 (사이클, 필수 입력, 타입 계약, orphan 노드 검사)
- DAG Run / Task Run 런타임 모델 도입
- Scheduler + Worker + Queue 기반 실행
- 상태 저장소 (run/task 상태, 로그, 이벤트, 재시도 이력)
- 실행 이벤트 스트림 + projection(모니터링/히스토리)
- Design-time API와 Runtime API 분리

### Out of Scope (1차)
- 멀티 테넌트 과금/권한 세부 정책
- 완전한 cron UI 빌더
- 외부 오케스트레이터(K8s Operator 등) 통합

---

## 3) 아키텍처 원칙

- **Design/Execution 분리**: DAG 편집 로직이 실행 엔진 내부 상태를 직접 변경하지 않는다.
- **Single Source of Truth**:
  - 정의 SSOT: `DAG Definition Store`
  - 실행 SSOT: `Run/Event Log Store`
- **No-Fallback**: 계약 필수 필드 누락/위반 시 즉시 실패.
- **Path-Only/Event Contract 준수**:
  - 런타임 추적 연결은 명시 필드만 사용
  - 이벤트명 하드코딩 금지(소유 모듈 상수 사용)
- **Responsibility Boundary**:
  - Scheduler/Worker/Queue/Projection 책임 분리
  - 메트릭/추적은 보조 모듈로 분리 주입

---

## 4) 목표 시스템 구조 (개념)

- **DAG Design Service**
  - DAG 생성/수정/검증/버전 발행
  - 정적 검증: cycle, missing input, invalid edge, type mismatch

- **DAG Runtime Service**
  - DAG Run 생성
  - 실행 계획(ready task 계산)
  - Task dispatch 요청 생성

- **Scheduler**
  - 주기/트리거 기반으로 DAG Run 생성
  - concurrency limit, backpressure 제어

- **Queue Broker**
  - Task execution message 전달
  - 재시도 메시지/지연 실행 메시지 지원

- **Worker**
  - Task handler 실행
  - input resolve -> execute -> output persist -> event emit
  - 실패 시 정책 기반 retry/terminal-fail 처리

- **Projection/Query Layer**
  - Event Log 기반으로 Run 상태/히스토리/뷰를 실시간 투영
  - 운영 대시보드/디버깅 조회 제공

- **Connection/Credential Service (n8n 참고)**
  - 노드 실행에 필요한 외부 연결 정보(credential/connection) 분리 관리
  - DAG 정의에는 credential 식별자만 저장하고, 실제 비밀값은 런타임에만 주입

- **Artifact/Log Store (Airflow 참고)**
  - task 실행 로그/산출물/메타데이터를 run/task 단위로 저장
  - 재시도/재실행 시 이전 시도 이력과 구분 가능해야 함

---

## 5) 데이터 모델 초안

### Design-time
- `DAGDefinition`
  - `dagId`, `version`, `name`, `description`
  - `status` (`draft | published | deprecated`)
  - `nodes: DAGNodeDefinition[]`
  - `edges: DAGEdgeDefinition[]`
  - `inputSchema`, `outputSchema`
  - `createdAt`, `publishedAt`, `updatedAt`
  - `createdBy`, `updatedBy`
  - `tags`, `labels`

- `DAGNodeDefinition`
  - `nodeId`, `nodeType`
  - `inputPorts`, `outputPorts`
  - `config` (handler-specific)
  - `retryPolicy`, `timeoutMs`, `concurrencyKey`
  - `dependsOn` (명시적 upstream 목록)
  - `triggerPolicy` (`all_success | one_success | always | custom`)
  - `executionPolicy` (`sync | async | external-worker`)

### Runtime
- `DAGRun`
  - `dagRunId`, `dagId`, `version`
  - `status` (`queued | running | success | failed | cancelled | timed_out`)
  - `trigger` (manual/schedule/event)
  - `scheduleRef` (스케줄 기반 실행 시 식별자)
  - `logicalDate` (Airflow의 logical date 개념)
  - `runKey` (멱등 생성 키)
  - `maxActiveTasks`, `priority`
  - `startedAt`, `endedAt`

- `TaskRun`
  - `taskRunId`, `dagRunId`, `nodeId`
  - `status` (`ready | queued | leased | running | success | failed | skipped | dead_letter`)
  - `attempt`, `maxAttempts`
  - `leaseOwner`, `leaseUntil` (worker lease/heartbeat 관리)
  - `inputSnapshot`, `outputSnapshot`, `error`
  - `startedAt`, `endedAt`

---

## 6) 실행 흐름 (요약)

1. Scheduler 또는 API가 `DAGRun` 생성  
2. Runtime Service가 entry node의 `TaskRun(ready)` 생성  
3. Queue dispatch -> Worker가 `lease` 획득 후 실행  
4. Worker가 output 저장 + `task.*`/`execution.*` 이벤트 발행  
5. Runtime Service가 trigger policy를 평가해 downstream readiness 계산 후 다음 task enqueue  
6. 모든 terminal 상태 집계 후 DAGRun 종료

---

## 7) 실패/재시도/멱등성 정책

- Task 실행 실패:
  - retryPolicy 내에서는 `queued`로 재등록
  - 초과 시 `failed` 또는 `dead_letter` terminal
- DAGRun 종료 조건:
  - 모든 필수 task 성공 -> `success`
  - terminal fail 발생 + policy상 중단 -> `failed`
- 멱등성:
  - `taskRunId` 기준 중복 실행 방지
  - `runKey` 기준 DAGRun 중복 생성 방지
  - 상태 전이는 단방향 유효 전이만 허용
- Lease/Heartbeat:
  - worker는 주기적으로 lease 갱신
  - lease 만료 task는 재할당 가능 상태로 되돌림
- DLQ(Dead Letter Queue):
  - 반복 실패 task를 격리 저장
  - 운영자가 원인 분석 후 재주입 가능

---

## 8) API 분리 전략

### Design API
- `POST /dag-definitions`
- `PUT /dag-definitions/:dagId/draft`
- `POST /dag-definitions/:dagId/validate`
- `POST /dag-definitions/:dagId/publish`

### Runtime API
- `POST /dag-runs`
- `GET /dag-runs/:dagRunId`
- `GET /dag-runs/:dagRunId/tasks`
- `POST /dag-runs/:dagRunId/cancel`
- `POST /dag-runs/:dagRunId/retry-failed`
- `POST /task-runs/:taskRunId/requeue`

### Scheduler/Operations API (Airflow 운영성 참고)
- `POST /schedules`
- `POST /schedules/:scheduleId/pause`
- `POST /schedules/:scheduleId/resume`
- `POST /dag-definitions/:dagId/backfill`
- `GET /operations/dead-letters`

---

## 9) 단계별 개발 로드맵

### Phase 0 - 계약/모델 확정
- DAGDefinition/DAGRun/TaskRun 타입 확정
- 이벤트 상수(owner별) 정의
- 상태 전이 표준 확정
- 기존 `workflow`와 신규 `dag` 패키지 경계 계약 확정(의존 금지 규칙 포함)

### Phase 1 - Design-time MVP
- DAG CRUD + validate
- 버전 발행(publish) 파이프라인
- 정적 검증기(cycle/type/input)
- credential reference 모델/검증 추가

### Phase 2 - Runtime MVP
- DAGRun 생성
- Ready queue 계산
- Worker 단일 프로세스 실행
- 기본 retry/timeout
- lease/heartbeat + requeue 구현

### Phase 3 - Scheduler/Worker 확장
- 스케줄 트리거
- 분산 worker
- 동시성 제한/백프레셔
- backfill/catchup(time window) 실행 지원
- DLQ + 운영 재주입 도구

### Phase 4 - 관측성/운영성
- 이벤트 projection 대시보드
- 실패 분석/재실행 도구
- 성능 지표/알림
- run/task lineage 조회 + bottleneck 분석 뷰

---

## 10) 의사결정 게이트 (필수 선택 항목)

대규모 구현 전에 아래 항목은 반드시 선택한다.

1. **Queue 기술 선택**
   - 옵션 A: Redis 기반 큐
   - 옵션 B: DB 기반 큐
   - 옵션 C: 외부 메시지 브로커

2. **Task 실행 격리 수준**
   - 옵션 A: 프로세스 내 실행
   - 옵션 B: worker 프로세스 분리
   - 옵션 C: 컨테이너 격리 실행

3. **재시도 기본 정책**
   - 옵션 A: fixed delay
   - 옵션 B: exponential backoff
   - 옵션 C: node별 정책 강제 입력

4. **Projection 저장 전략**
   - 옵션 A: 메모리 + 스냅샷
   - 옵션 B: DB materialized view
   - 옵션 C: 하이브리드

5. **패키지 네이밍 최종 결정**
   - 옵션 A: `@robota-sdk/dag` (권장)
   - 옵션 B: `@robota-sdk/flow`

---

## 11) 완료 기준 (Definition of Done)

- Design-time과 Runtime 코드 경계가 명확히 분리됨
- 기존 `workflow` 패키지를 수정하지 않고 신규 `dag` 패키지에서 독립 동작
- DAG static validation이 배포 전/실행 전 모두 동작
- DAGRun/TaskRun 상태 전이 테스트 통과
- Worker 실패/재시도/종료 시나리오 테스트 통과
- 빌드/타입/린트 0 에러
- 운영 조회 API에서 run/task/event 조회 가능

---

## 12) 다음 액션

1. Phase 0 타입 계약 문서 상세화 (`interfaces` 초안)
2. Queue/Worker 기술 선택 게이트 결정
3. 신규 패키지 경로 확정: `packages/dag` (기존 `packages/workflow` 동결)
4. Design-time MVP(Phase 1) 구현 태스크 분해
5. Runtime MVP(Phase 2) 테스트 시나리오 먼저 작성

---

## 13) n8n/Airflow 참조 기반 보강 포인트

### n8n에서 가져올 점
- 노드 단위 입출력 계약(JSON payload) + 포트 기반 연결 모델
- Trigger 노드와 Action 노드 역할 분리
- Credential/Connection 분리 저장
- Sub-workflow 호출 패턴(Phase 4 이후)

### Airflow에서 가져올 점
- DAG Definition(정의)과 DAG Run(실행) 엄격 분리
- Scheduler 중심의 실행 생성, Worker 중심의 실행 수행
- logical date / backfill / catchup 운영 모델
- Pool/Concurrency/priority 기반 리소스 제어

### 그대로 가져오지 않을 점 (Robota 맞춤)
- Python 중심 DSL/Operator 생태계는 직접 도입하지 않음
- 지나치게 무거운 중앙 스케줄러 단일 병목 구조는 피하고, 초기에는 단순한 scheduler + queue로 시작

---

## 14) 패키지 구조 제안 (신규)

`packages/dag/src/`
- `design/` (definition, validator, publisher)
- `runtime/` (run-service, task-planner, state-machine)
- `scheduler/` (cron trigger, backfill, catchup)
- `worker/` (lease, heartbeat, executor adapter)
- `queue/` (broker abstraction)
- `storage/` (definition/run/task/event repositories)
- `projections/` (run view, task view, lineage view)
- `interfaces/` (public contracts; SSOT)
- `index.ts` (public surface)

---

## 15) 기존 `workflow`와의 전환 전략

- Step 1: `workflow`는 유지, 신규 기능은 `dag`에서만 개발
- Step 2: Playground/Web에서 feature flag로 `workflow`/`dag` 렌더 선택
- Step 3: 동일 시나리오를 양쪽 엔진으로 실행해 결과 비교 검증
- Step 4: 안정화 후 기본 엔진을 `dag`로 전환
- Step 5: `workflow`는 read-only 호환 레이어로 축소

---

## 16) 리스크와 완화 전략

- **리스크: 스케줄러/워커 상태 불일치**
  - 완화: lease + heartbeat + state transition guard
- **리스크: 중복 실행**
  - 완화: `runKey`/`taskRunId` 멱등 키 강제
- **리스크: DAG 정의 변경으로 실행 중 충돌**
  - 완화: 실행은 항상 immutable `version` 참조
- **리스크: 대량 DAG로 성능 저하**
  - 완화: projection 분리, pagination, hot-path 인덱스

