# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**만 관리합니다.  
> 완료 항목은 `COMPLETED-TASKS.md`로 이동합니다.

---

## Gate 체크포인트 (필수)

### Gate-1 Scope Freeze (P0 종료 전)
- [ ] v1 포함/제외 목록 승인 완료
- [ ] scope 변경 시 RFC 프로세스 적용 규칙 문서화

Pass 기준:
- [ ] 개발 항목이 v1 포함 범위로만 제한됨

### Gate-2 Time Semantics (P1 종료 전)
- [ ] 시간 정책(UTC/logicalDate/수동 실행 우선) 문서 고정
- [ ] time semantics 테스트 케이스 작성

Pass 기준:
- [ ] 시간 정책 테스트 통과

### Gate-3 Execution Guarantee (P2 종료 전)
- [ ] `at-least-once + idempotency(runKey/taskRunId)` 정책 고정
- [ ] lease 만료/재할당 시나리오 테스트 작성

Pass 기준:
- [ ] 멱등성/재할당 테스트 통과

---

## DAG Phase 실행 계획

### P0-pre 규칙 준수 보완 (P0 착수 전)
- [ ] DAG 이벤트 프리픽스 체계 확정 (dagrun/dagtask/dagworker/dagscheduler)
- [ ] v1 어댑터 스펙 확정 (InMemory queue/lease, storage 방식 결정)
- [ ] 에러 분류 체계 확정 (DAG-VALIDATION/STATE-TRANSITION/LEASE-CONTRACT/DISPATCH-CONTRACT/TASK-EXECUTION)
- [ ] 상태 머신 순수 함수 설계 원칙 확정
- [ ] 브라우저/Node 호환 경계 확정 (dag-core 금지 API 목록)
- [ ] executionPath 설계 확정 (ownerPath 대응)
- [ ] Gate-1 승인 (v1 포함/제외 확정)

### P0 기반 계약/스캐폴딩
- [ ] `pnpm-workspace.yaml`에 `packages/dag-*` 추가
- [ ] `packages/dag-core` 생성
- [ ] `packages/dag-runtime` 생성
- [ ] `packages/dag-worker` 생성
- [ ] `packages/dag-scheduler` 생성
- [ ] `packages/dag-projection` 생성
- [ ] `packages/dag-api` 생성
- [ ] `packages/dag-designer` 생성
- [ ] core 타입/상수/포트/상태머신 구현
- [ ] mock 어댑터 모듈 (`dag-core/src/testing/`) 생성
- [ ] `project-structure-rules.mdc` 패키지 목록 업데이트
- [ ] `workflow-event-rules.mdc` DAG 이벤트 프리픽스 추가
- [ ] `skills-link-rules.mdc` DAG 도메인 섹션 추가

완료기준:
- [ ] `pnpm --filter @robota-sdk/dag-* build` 통과
- [ ] 순환 의존 0건
- [ ] Gate-1 Pass

### P1 Design-time MVP
- [ ] DAG definition CRUD + validate + publish 구현
- [ ] `dag-designer` validate/publish 연동
- [ ] invalid definition failure 테스트 구현

완료기준:
- [ ] validate/publish E2E 통과
- [ ] Gate-2 Pass

### P2 Runtime MVP
- [ ] run orchestrator + worker loop + retry/timeout/lease 구현
- [ ] runtime API(trigger/query/cancel) 구현
- [ ] mock infra 기반 단일 DAGRun E2E 구축

완료기준:
- [ ] 단일 DAGRun E2E 성공
- [ ] 실패->retry->terminal 시나리오 통과
- [ ] Gate-3 Pass

### P3 Scheduler/확장
- [ ] scheduler 기본 트리거 구현
- [ ] backfill/catchup(제한 범위) 구현
- [ ] DLQ/재주입 경로 구현

완료기준:
- [ ] scheduler 연계 통합 테스트 통과

### P4 관측성/운영성
- [ ] projection(run/task/lineage) 완성
- [ ] 운영 조회 API/대시보드 연동
- [ ] 운영 진단 도구(재실행/실패 분석) 추가

완료기준:
- [ ] 운영 조회/진단 시나리오 통과
