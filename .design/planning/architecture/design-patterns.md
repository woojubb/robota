# Planning Architecture — Design Patterns (요약)

> 구체적인 Planner 구현 작업은 `CURRENT-TASKS.md`와 `.design/open-tasks/FUTURE-PROJECTS.md`에서 관리합니다. 본 문서는 Planning 시스템에 권장되는 설계 패턴을 짧게 정리합니다.

## 패턴 요약
- **BasePlanner + PlannerContainer**: 모든 Planner가 공통 추상 클래스를 확장하고, Container가 등록/선택을 담당
- **Tool Registry**: Planner 전용 Tool을 `id → builder` 매핑으로 관리하여 동적 확장을 허용
- **Event-Driven Hooks**: Planner 실행 상태를 ActionTrackingEventService에 emit 하여 Workflow 시각화와 동일한 이벤트 파이프라인을 사용
- **Dependency Injection**: Planner, Tool, AgentFactory 간 의존성을 생성자 인자로만 주입하여 테스트 용이성 확보

## 참고
- `.design/open-tasks/FUTURE-PROJECTS.md` Planning System 섹션
- `packages/agents/src/managers/agent-factory.ts`
