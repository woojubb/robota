# Planning Tool Implementation Notes (요약)

> Planner 전용 도구 구현은 향후 CURRENT-TASKS에 포함됩니다. 이 문서는 구현 시 주의사항만 남깁니다.

## 지침
- Tool은 `executor`, `eventService`, `logger` 등 추상 의존성을 주입받고 RemoteExecutor를 통해 실행
- Tool은 Planner Context(예: role, goal, dependency info)를 read-only로 받아야 하며, Workflow 구조를 직접 수정하지 않음
- owner-bound EventService(absolute ownerPath-only)로 `tool.call_start`, `tool.call_response_ready` 이벤트를 emit
- Tool 결과는 Planner가 사용할 수 있는 표준 구조 `{ outcome, metadata }`로 반환

---

세부 구현은 FUTURE-PROJECTS 문서와 Planner별 CURRENT-TASKS 항목을 참고하세요.
