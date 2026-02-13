---
title: "완료 작업 기록"
description: "CURRENT-TASKS에서 완료 처리된 항목을 보관한다"
---

# 완료 작업 기록
> 이 문서의 완료 항목은 스킬/룰/README/spec/future 문서로 흡수되었다.

## 2026-02-07

### Priority 0.7: Type Ownership Audit (SSOT) + Prefix Rollout
- StructuredEventService owner prefix 합성 emit 적용
- local event name 검증(`.` 포함 시 오류)
- 사용자/태스크 이벤트 호출부 local name 전환
- Event name ownership 단일화(Batch E)
- Type ownership audit 인벤토리 작성
- Batch A-D(로컬 유니온 제거/계약 단일화) 확인 완료

### Event Log SSOT + 실시간 투영
- Event Log 저장소/스키마 확정
- 로그 입력 경로 단일화(수신 → Log append)
- Incremental Projection 구현(Workflow/History)
- 스냅샷/체크포인트 규칙 구현
- WorkflowEventSubscriber 역할 축소
- 리플레이 모드 구현(시작 시퀀스는 호출자 결정)

### Event Log 구현(개발 단계) 완료
- Step 1~10 완료(스키마, store, snapshot, projections, replay, tests)

### History Module 분리 구현 완료
- Step 1~5 완료(인터페이스, store, listener 연결, 투영 연결)

### Event 시스템 실행 계획(부분 완료)
- 중앙 매칭 단일화(`eventName -> handler` 단일 매칭)
- 핸들러 클래스/팩토리 계층 제거

### Event 시스템 실행 계획(잔여 작업) 완료
- [E-01] 이벤트 단위 최소 기록 정책 확정
- [E-02] 정렬 기준 `ownerPath → timestamp → eventType/sequence` 확정
- [E-03] 오류 처리 단일화(핸들러 내부 try/catch 제거)
- [E-04] 결과 구조 최소화(`success/updates/errors`)
- [E-05] Bridge/Adapter 네이밍 정리(`workflow-event-service-bridge`)
- [E-06] 단일 기본 핸들러 레지스트리 구성
- [E-08] `metadata`/`processed` 플래그 최소화

### Projection/Scenario 계획 완료
- [P-01] Projection 캐시 설계/인터페이스/초기 구현/테스트 완료
- [S-01] 시나리오 도메인 분리 완료
- [S-02] Play 모드 tool 결과 재생 정책 고정 완료
- [S-03] 단일 CLI 진입점 통합(record/play/verify) 완료
- [S-04] 병렬 tool call 기본 전략 `hash` 통일 완료
- [S-05] guarded 시나리오 검증 명령 템플릿/재녹화/검증 완료

### 이벤트 시스템 점검 기반 개선 작업 완료
- [R-01] EventEmitterPlugin 에러 재귀 차단 완료
- [R-02] WorkflowEventServiceBridge 비동기 오류 전파 정책 정리 완료
- [R-03] 이벤트 핵심 모듈 단위 테스트 추가 완료
- [R-04] EventEmitterPlugin `getStats()` 실제 카운팅 반영 완료

## 2026-02-08

### Workflow 규칙 정합화 (P0~P2 Phase A) 완료
- [P0] `agent-event-handler` dedup/silent-success 제거 완료
- [P0] `workflow-event-service-bridge` 즉시 실패 전파 + 실패 후 emit 차단 테스트 추가 완료
- [P0] `toolTypeMap` 제거로 handler neutrality 정리 완료
- [P1] 금지 용어(`parentAgentId`/`childAgentId`)를 `delegating/delegated`로 정리 완료
- [P1] projection cache 이벤트 prefix 하드코딩 제거(agents 상수 기반) 완료
- [P1] 미사용 보조 상태/데드코드(`workflow-state`, `workflow-state-access`) 제거 완료
- [P2-1] `tool_response_call_*` 네이밍 추론 제거 완료 (ownerPath + 기존 노드 explicit data 스캔 방식)
- [P2-2 Phase A] event record 변환 단일 어댑터화 완료
  - `event-record-adapter.ts` 신설
  - `workflow-projection`의 변환 로직 분산 제거
- [P2] playground 타입 용어 정합성(`delegatingAgentId`) 반영 완료

### 규칙/스킬 정렬 강화 완료
- `EMITTER-CONTRACT` / `APPLY-LAYER` 실패 분류 규칙 반영
- `Node/Edge Creation Contract` 용어 및 금지 규칙(메타 필드로 링크 결정 금지) 반영
- Decision Gate Protocol(중요 선택 시 사용자 선택 후 진행) 스킬 반영

### 검증 완료
- `@robota-sdk/workflow` 테스트/빌드 통과
- `@robota-sdk/playground` 빌드 통과
- workflow scenario verify 템플릿(`guarded`/`continued`) 통과
- rules/skills 충돌 스캔 재실행 완료

### P2-2 Phase B (조기 착수/완료) - Event Record SSOT 통합
- 사용자 지시로 Phase B 즉시 착수 후 완료
- `TEventLogRecord`를 `IEventHistoryRecord` 기반 단일 축으로 통합
- workflow event-log/store/projection 계약을 `eventData + context.ownerPath + sequenceId` 기준으로 정렬
- `event-record-adapter`를 record 변환이 아닌 `TEventData` 정규화(no-op 성격)로 축소
- 검증:
  - `pnpm --filter @robota-sdk/workflow test` 통과
  - `pnpm --filter @robota-sdk/workflow build` 통과
  - `pnpm --filter @robota-sdk/agents build` 통과
  - `pnpm --filter @robota-sdk/playground build` 통과
