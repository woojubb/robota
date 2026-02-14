# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**만 관리합니다.  
> 완료 항목은 `COMPLETED-TASKS.md`로 이동합니다.

---

## 규칙 완전 준수 루프 (다음 배치)

### P2 - 재감사/반복 루프
- [x] `playground` `workflow-visualization.tsx` 타입 경계 정리
  - 목표:
    - 광범위 union(`IWorkflowVisualizationNodeData` 확장 필드) 직접 접근 구간을 헬퍼로 단일화
    - `parameters/result/response` 접근 시 object/record 가드 경로만 사용
    - ReactFlow `Node/NodeChange` 제네릭 경계와 로컬 상태 타입 정합성 일치
  - 완료기준:
    - 동일 파일 IDE 타입 오류 핵심 축(속성 접근/제네릭 불일치) 정리
    - `pnpm --filter @robota-sdk/playground build` 통과 유지

- [x] 재검증 루프 1회 수행 (`agents/workflow/playground`)
  - 목표:
    - no-fallback / no-dedup / path-only / event-constant / strict-type 규칙 재점검
  - 완료기준:
    - 신규 위반이 없으면 문서에 “잔여 위반 없음”으로 기록
    - 신규 위반이 있으면 다음 배치 체크리스트로 즉시 등록

## 현재 잔여 위반

- 이번 배치 스캔/빌드 기준 잔여 위반 없음
