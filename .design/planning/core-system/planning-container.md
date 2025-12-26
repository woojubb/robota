# Planning Container (요약)

> Planner Container 구현은 추후 CURRENT-TASKS에 추가될 때 진행합니다. 본 문서는 Container 개념만 간단히 설명합니다.

## 역할
- 여러 Planner 구현(CAMEL/ReAct/Reflection/Sequential)을 등록/선택하는 Factory 역할
- 공통 의존성(AgentFactory, ToolRegistry, EventService, logger)을 생성자에서 주입받아 각 Planner에게 전달
- Planner lifecycle (`initialize → createPlan → executePlan → cleanup`)을 표준화

## API 초안
```ts
interface PlannerContainer {
  register(id: string, builder: PlannerBuilder): void;
  create(id: string, options: PlannerOptions): BasePlanner;
}
```

## 주의사항
- Container는 Planner 인스턴스를 캐시하지 않고, 요청마다 새 Planner를 생성 (stateful Planner는 자체적으로 상태 관리)
- Planner가 내보내는 이벤트는 owner-bound EventService(absolute ownerPath-only)를 통해 Execution Workflow와 동일하게 기록

---

세부 일정은 `.design/open-tasks/FUTURE-PROJECTS.md` Planning 섹션을 참고하세요.
