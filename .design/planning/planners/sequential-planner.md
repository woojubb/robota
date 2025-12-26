# Sequential Planner (요약)

> Sequential Planner 구현은 장기 로드맵에 포함되어 있으며, 세부 작업은 FUTURE-PROJECTS/CURRENT-TASKS에서 관리합니다.

## 목표
- 복잡한 작업을 단계별 실행 계획으로 분해하고 의존성을 관리

## 구성 요소
- TaskDecomposer: 입력 작업을 서브 작업 목록으로 분해
- DependencyManager: 선후 관계 그래프를 유지
- ExecutionOrchestrator: 의존성이 충족될 때마다 다음 작업을 실행

## Workflow 통합
- 각 Sub-task 실행은 기존 Workflow 이벤트(`tool_call`, `agent_thinking`, `tool_result`) 규칙을 그대로 사용
- Planner는 ExecutionOrchestrator 상태를 owner-bound EventService(absolute ownerPath-only)에 emit하여 시각화와 동기화

---

세부 구현은 FUTURE-PROJECTS Planning 섹션을 참고하세요.
