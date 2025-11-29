# Planning Migration Guide (요약)

> Planner 도입 시 마이그레이션 절차는 향후 `CURRENT-TASKS.md`에서 단계별로 진행합니다. 본 문서는 전환 시 고려 사항만 정리합니다.

## 마이그레이션 단계
1. **Config Export**: 기존 Agent/Tool 구성을 JSON Config 형태로 덤프 (`AgentConfigObject`)
2. **Planner 연결**: Planner가 반환한 ExecutionPlan을 AgentFactory/ToolFactory와 연결하여 실제 실행으로 변환
3. **Event 호환성 확인**: Planner가 emit 하는 이벤트가 ActionTrackingEventService/WorkflowSubscriber 규칙을 준수하는지 검증
4. **Rollback 전략**: Planner 기능이 불안정할 경우 `createPlanner()` 대신 기존 수동 실행 경로로 전환할 수 있도록 feature flag 제공

## 체크리스트 요약
- [ ] Agent/Tool Config 직렬화/역직렬화 검증
- [ ] Planner 이벤트 Path-Only/No-Fallback 준수
- [ ] RemoteExecutor/Provider 연동 테스트
- [ ] Guarded 예제 실행 (예제 26/27)

---

자세한 일정과 작업 항목은 FUTURE-PROJECTS 또는 향후 CURRENT-TASKS 항목으로 이전해 주세요.
