# Planning Usage Examples (요약)

> 구체적인 예제 코드는 추후 `apps/examples` 및 문서화 작업에서 제공됩니다. 이 문서는 Planner 사용 패턴을 짧게 소개합니다.

```ts
import { PlannerContainer } from '@robota-sdk/planning-core';
import { AgentFactory } from '@robota-sdk/agents';

const planner = container.create('camel', {
  agentFactory,
  toolRegistry,
  defaultModel,
});

const plan = await planner.createPlan(taskDefinition);
const result = await planner.executePlan(plan);
```

- Planner는 AgentFactory/ToolRegistry를 주입받아 ExecutionPlan을 생성하며, 실행 과정에서 ActionTrackingEventService를 사용해 이벤트를 emit합니다.
- 결과는 WorkflowVisualization와 동일한 구조로 기록되므로 예제 26/27 검증 스크립트를 재사용할 수 있습니다.

---

추가 예제가 필요하면 CURRENT-TASKS에 작업을 추가하거나 `apps/examples` 디렉터리에 샘플을 작성해 주세요.
