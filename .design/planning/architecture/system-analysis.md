# Planning System Analysis (요약)

> Planning 시스템의 세부 로드맵은 `.design/open-tasks/FUTURE-PROJECTS.md`와 `CURRENT-TASKS.md`(필요 시)에서 추적합니다. 이 문서는 요구사항과 제약 조건을 요약합니다.

## 요구사항
- Planner는 Agent/Tool 실행 파이프라인과 동일한 EventService/Workflow 구조를 사용해야 함
- CAMEL/ReAct/Reflection/Sequential 등 다양한 전략을 플러그인 형태로 교체 가능해야 함
- Planner가 생성한 실행 계획은 AgentFactory를 통해 실제 Agent/Tool 조합으로 전환되어야 함

## 제약 조건
- Path-Only/단일 경로 원칙을 유지 (Planner가 Workflow를 생성할 때도 동일한 검증을 거침)
- Planner가 외부 API를 호출할 경우 RemoteExecutor를 재사용
- Planner 설정은 JSON 직렬화 가능한 Config Object로 유지 (Agent Config와 유사)

## 참고
- `.design/open-tasks/FUTURE-PROJECTS.md` Planning System 섹션
- `packages/agents/src/managers/agent-factory.ts`
