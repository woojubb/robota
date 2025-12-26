# Planning Tool Architecture (요약)

> Planner용 Tool 시스템의 세부 구현은 향후 CURRENT-TASKS에서 다룹니다. 이 문서는 Tool Registry 개념을 요약합니다.

## 개념
- `ToolConfig { id, name, parameters, metadata }` → UnifiedToolFactory가 Tool 인스턴스로 변환
- Planner는 ToolRegistry를 통해 필요한 도구만 선택/구성하며, Tool 실행은 RemoteExecutor를 재사용
- Tool 이벤트는 `tool.*` 상수와 owner-bound EventService(absolute ownerPath-only)를 사용하여 Path-Only 규칙을 유지

## Registry API 초안
```ts
interface PlanningToolRegistry {
  register(id: string, builder: ToolBuilder): void;
  create(id: string, config: ToolConfig): Tool;
}
```

---

세부 단계는 FUTURE-PROJECTS Planning 섹션을 참고하세요.
