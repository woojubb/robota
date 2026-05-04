---
title: 오케스트레이션 레벨 노드 공통 상태 관리
status: completed
created: 2026-03-15
priority: high
urgency: later
---

## 개념

오케스트레이션은 오케스트라의 지휘자처럼 DAG 내 모든 노드의 상태를 통합 관리해야 한다.

## 요구사항

1. **노드 종류 무관 공통 상태**: 오케스트레이션이 현재 DAG에 존재하는 모든 노드의 상태를 보유
   - 노드별 부수작업 상태 (업로드 중, 대기, 완료 등)
   - 실행 상태 (idle, running, success, failed)
   - 실행 결과 (일시적 보유)

2. **부수작업 반영**: 노드가 파일 업로드 등 비동기 작업을 수행할 때 오케스트레이션 상태에 반영
   - 현재 dag-designer의 `pendingOperations`는 UI 레벨에만 있음
   - 이걸 오케스트레이션 레벨로 올려야 함

3. **Run 등 액션 조건**: 오케스트레이션 상태를 기반으로 Run 버튼 활성화/비활성화 판단
   - 모든 노드가 ready 상태일 때만 실행 가능
   - 특정 노드가 작업 중이면 실행 차단

## 현재 상태

- `pendingOperations`가 dag-designer context (UI)에만 존재
- 실행 상태/결과는 orchestrator-server의 `OrchestratorRunService`에서 관리 (인메모리)
- 두 상태가 분리되어 있음

## 설계 방향

- 오케스트레이션 레벨에 `INodeStateMap` 같은 공통 상태 모델 정의
- 각 노드의 상태를 통합 (pending operations + execution status + results)
- dag-designer는 이 상태를 참조하여 UI 표시 및 액션 제어

## 진행 기록

- 2026-05-05: 기존 구현 확인 결과 `dag-designer` 내부 `nodeStateMap`이 업로드/실행 상태를 일부 통합하고 있으나, 타입과 전이 규칙이 React context에 남아 있어 공통 오케스트레이션 상태 SSOT가 없음. `dag-core`에 공통 노드 상태 타입과 순수 상태 reducer를 추가하고 `dag-designer`가 이를 소비하도록 마이그레이션한다.
- 2026-05-05: `dag-core`에 `IDagNodeState`/`TNodeStateMap` 및 순수 reducer를 추가하고, `dag-designer`의 React context가 이를 소비하도록 마이그레이션 완료. 업로드 같은 노드 부수작업 상태와 실행 상태를 분리했고, Run 가능 여부는 `isDagNodeStateMapRunnable()`으로 판단한다.

## 결과

- 공통 노드 상태 SSOT: `packages/dag-core/src/types/node-state.ts`
- 순수 상태 reducer: `packages/dag-core/src/state/dag-node-state.ts`
- 디자이너 연동: `packages/dag-designer/src/components/dag-designer-context.tsx`
- 검증: `pnpm build`, `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
