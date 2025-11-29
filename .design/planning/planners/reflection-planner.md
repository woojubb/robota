# Reflection Planner (요약)

> Reflection Planner의 세부 구현은 향후 CURRENT-TASKS에 추가될 때 진행합니다. 이 문서는 핵심 개념만 남겨둡니다.

## 목표
- 실행 후 자기 평가(Reflection) 단계에서 품질을 개선
- QualityEvaluator/ImprovementOrchestrator를 통해 계획을 반복적으로 수정

## 흐름
1. Planner가 초기 실행을 수행하고 결과/메트릭을 수집
2. ReflectionEngine이 품질 지표를 분석하고 개선점 제안
3. Planner가 개선된 실행 계획을 재생성하여 AgentFactory/ToolRegistry로 전달

## Path-Only 통합
- Reflection 단계의 각 이벤트는 agent_thinking/response/tool_result 노드로 기록하여 기존 Workflow 시각화와 호환

---

추가 일정은 FUTURE-PROJECTS Planning 섹션을 참고하세요.
