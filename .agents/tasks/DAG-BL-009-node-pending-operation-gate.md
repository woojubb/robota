---
title: 노드 부수작업 진행 중 Run 차단 + 업로드 프로그레스 표시
status: backlog
created: 2026-03-15
priority: high
urgency: later
---

## 문제

파일 업로드가 완료되기 전에 Run을 누르면 config에 asset이 없어서 실행 실패.
업로드 중인지 사용자가 알 수 없음.

## 요구사항

1. **업로드 프로그레스 표시**: 파일 선택 → API 응답까지 사이드 패널에 상태 표시 (업로드 중...)
2. **Run 버튼 비활성화**: 어떤 노드라도 부수작업(업로드 등) 진행 중이면 Run 불가
3. **범용 패턴**: 업로드에 한정하지 않고, 노드가 비동기 작업 중이면 Run 조건 불충족

## 설계 방향

- dag-designer context에 `pendingOperations: Map<nodeId, string>` 같은 상태 추가
- 업로드 시작 시 `addPendingOperation(nodeId, 'uploading')`, 완료 시 `removePendingOperation(nodeId)`
- `pendingOperations.size > 0`이면 Run 버튼 disabled
- 사이드 패널에 해당 노드의 pending 상태 표시

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
