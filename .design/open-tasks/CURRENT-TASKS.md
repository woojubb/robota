# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**만 관리합니다.  
> 완료 항목은 `COMPLETED-TASKS.md`로 이동합니다.

---

## Gate 체크포인트 (필수)

### Gate-1 Scope Freeze (P0 종료 전)
- [x] v1 포함/제외 목록 승인 완료
- [x] scope 변경 시 RFC 프로세스 적용 규칙 문서화

Pass 기준:
- [x] 개발 항목이 v1 포함 범위로만 제한됨

### Gate-2 Time Semantics (P1 종료 전)
- [x] 시간 정책(UTC/logicalDate/수동 실행 우선) 문서 고정
- [x] time semantics 테스트 케이스 작성

Pass 기준:
- [x] 시간 정책 테스트 통과

### Gate-3 Execution Guarantee (P2 종료 전)
- [x] `at-least-once + idempotency(runKey/taskRunId)` 정책 고정
- [x] lease 만료/재할당 시나리오 테스트 작성

Pass 기준:
- [x] 멱등성/재할당 테스트 통과

---

## DAG Phase 실행 계획

### P0-pre 규칙 준수 보완 (P0 착수 전)
- [x] DAG 이벤트 계층 분리 규칙 확정 (run/task/worker/scheduler + 안전장치 3개)
- [x] v1 어댑터 스펙 확정 (필수 Adapter만 기술 사전 확정: Storage/Clock)
- [x] 에러 체계 확정 (내부 code-first + 외부 RFC7807 + retryable 정책)
- [x] 상태 머신 순수 함수 설계 원칙 확정
- [x] 브라우저/Node 호환 경계 확정 (dag-core 금지 API 목록)
- [x] executionPath 설계 확정 (ownerPath 대응)
- [x] Gate-1 승인 (v1 포함/제외 확정)

### P0 기반 계약/스캐폴딩
- [x] `pnpm-workspace.yaml`에 `packages/dag-*` 추가
- [x] `packages/dag-core` 생성
- [x] `packages/dag-runtime` 생성
- [x] `packages/dag-worker` 생성
- [x] `packages/dag-scheduler` 생성
- [x] `packages/dag-projection` 생성
- [x] `packages/dag-api` 생성
- [x] `packages/dag-designer` 생성
- [x] core 타입/상수/포트/상태머신 구현
- [x] mock 어댑터 모듈 (`dag-core/src/testing/`) 생성
- [x] `project-structure-rules.mdc` 패키지 목록 업데이트
- [x] `workflow-event-rules.mdc` DAG 이벤트 계층/안전장치 반영
- [x] `skills-link-rules.mdc` DAG 도메인 섹션 추가

완료기준:
- [x] `pnpm --filter @robota-sdk/dag-* build` 통과
- [x] 순환 의존 0건
- [x] Gate-1 Pass

### P1 Design-time MVP
- [x] DAG definition CRUD + validate + publish 구현
- [x] `dag-designer` validate/publish 연동
- [x] invalid definition failure 테스트 구현

완료기준:
- [x] validate/publish E2E 통과
- [x] Gate-2 Pass

### P2 Runtime MVP
- [x] run orchestrator + worker loop + retry/timeout/lease 구현
- [x] 상위 조립 경로에서 worker fail-fast 기본값 강제 (`retryEnabled=false`, opt-in retry)
- [x] runtime API(trigger/query/cancel) 구현
- [x] mock infra 기반 단일 DAGRun E2E 구축

완료기준:
- [x] 단일 DAGRun E2E 성공
- [x] 실패->retry->terminal 시나리오 통과
- [x] Gate-3 Pass

### P3 Scheduler/확장
- [x] scheduler 기본 트리거 구현
- [x] backfill/catchup(제한 범위) 구현
- [x] DLQ/재주입 경로 구현

완료기준:
- [x] scheduler 연계 통합 테스트 통과

### P4 관측성/운영성
- [x] projection(run/task/lineage) 완성
- [x] 운영 조회 API/대시보드 연동
- [x] 운영 진단 도구(재실행/실패 분석) 추가

완료기준:
- [x] 운영 조회/진단 시나리오 통과

---

## 구조 개선 후속 조치 (심층 검토 반영)

### Critical 수정 (우선)
- [x] downstream task dispatch 구현 (entry node 이후 후속 ready node 생성/큐잉)
- [x] DLQ 재주입 시 task 상태 복구 (`failed -> queued`) 후 재주입
- [x] diagnostics 재주입 정책 게이트 추가 (`reinjectEnabled=false` 기본, 미승인 시 차단)
- [x] `retryEnabled=false`일 때 terminal 상태 재활성화 금지 E2E 테스트 추가

완료기준:
- [x] 다중 노드 DAG E2E에서 순차 실행(entry -> downstream) 통과
- [x] DLQ 재주입 후 실제 재실행(`START` 전이) 통과
- [x] no-fallback 기준에서 재주입 경로 기본 차단 검증 통과

### Complexity 축소 (Phase 1)
- [x] 에러 빌더(`validation/dispatch/lease`) 공통 유틸로 통합
- [x] `toProblemDetails`/API 응답 타입 중복 제거 (contracts 공통화)
- [x] `replaceAttemptSegment` 중복 유틸 제거
- [x] `queuedTaskRunIds` 명칭/의미 정합성 개선

완료기준:
- [x] 중복 유틸/타입 제거 후 기존 테스트 스위트 100% 통과

### 구조 단순화 (Phase 2)
- [x] controller 내부 service 생성 제거, composition root DI로 일원화
- [x] `WorkerLoopService.processOnce` 분해 (success/failure/retry/finalize 경로 분리)
- [x] observability dashboard 중복 조회 최적화 (`buildRunProjection` 중복 호출 제거)

완료기준:
- [x] 코드 복잡도 감소(메서드 분해) + API/동작 회귀 없음
