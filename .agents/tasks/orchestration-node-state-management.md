---
title: 오케스트레이션 레벨 노드 공통 상태 관리
status: backlog
created: 2026-03-15
priority: high
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
