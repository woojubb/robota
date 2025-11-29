# Scenario Recorder 확장 설계

> 목적: 예제 26 Guarded 실행을 완전 playback 모드로 재현하기 위해 Agent/Tool/환경 전체를 기록·재생하는 구조를 정의한다. Priority 1 단계 3의 “Scenario Recorder 확장” 항목을 수행하는 기준 문서이다.

## 1. 환경 스냅샷 (ScenarioEnvironment)
```json
{
  "scenarioId": "26-mandatory-delegation",
  "version": 2,
  "environment": {
    "agentConfig": { /* AgentConfig 전체 */ },
    "toolRegistry": { /* tool id → handler/meta */ },
    "providerOrder": ["anthropic", "openai"],
    "executionContext": {
      "rootExecutionId": "conv_...",
      "recordScenarioId": "26-mandatory-delegation",
      "mockScenarioId": null
    }
  },
  "steps": []
}
```
- AgentConfig: name, description, providers, plugins, tools, system message, limits 등 런타임 설정 전체를 JSON으로 저장한다.
- ToolRegistry: tool id, implementation 경로, provider 의존성, assignTask 템플릿 등 메타데이터를 포함한다.
- ExecutionContext: rootExecutionId, scenarioId, recorder/mock 플래그를 저장하여 nested agent에도 전달한다.

## 2. Tool Recorder/Mock
### Recorder
- 위치: ToolRegistry(or ToolExecutor)가 Tool 인스턴스를 실행하기 직전에 래핑.
- Step 구조:
```json
{
  "type": "tool",
  "toolCallId": "tool_call_1",
  "toolName": "assignTask",
  "input": {...},
  "context": { "executionId": "exec_...", "agentId": "agent_1" },
  "toolConfigSnapshot": {...},
  "result": {...},
  "timestamp": 1763563909000
}
```
- nested agent 실행이 필요하면 `result.childContext`에 scenarioId/parent 정보를 기록.

### Mock
- playback 모드에서는 ToolRegistry가 실제 Tool 대신 `ScenarioMockTool`을 반환.
- `mockStepStrategy` (sequential/byHash)로 recorded step을 조회 후 동일 payload를 반환.
- step 미존재 시 `ScenarioMissingError`를 던져 Guard 실패를 유도한다.

## 3. Agent Recorder/Mock 체인
- ExecutionService가 Agent를 생성할 때 현재 `ScenarioContext`를 clone하여 주입한다.
- child agent가 생성되면 `ScenarioContext.child('agent', childId)`로 전파하여 provider/ tool recorder 모두 동일 시나리오를 사용하도록 한다.
- playback 모드에서는 실제 Provider/Tool 호출이 0회가 되어야 하므로, Recorder/Mock는 항상 쌍으로 동작해야 한다.

## 4. CLI 및 검증 흐름
1. `pnpm scenario:record --example=26 --scenario=mandatory-delegation`
   - 실제 Provider 호출 + Recorder 활성화
2. `pnpm scenario:play --example=26 --scenario=mandatory-delegation`
   - Mock Provider + Mock Tool + Mock Agent 실행
3. `pnpm scenario:verify --example=26 --scenario=mandatory-delegation`
   - playback 모드 실행 후 Guarded 예제 + scenario step 소비 여부 검사

## 5. Guard 통합 체크리스트
- Guard 스크립트는 `SCENARIO_RECORD_ID`/`SCENARIO_PLAY_ID`를 감지하여 Recorder/Mock를 자동 주입한다.
- playback 모드에서 실제 Provider/Tool 호출이 발생하면 즉시 예외를 던진다.
- 실행 후 scenario step이 모두 소비되었는지 확인하고 남은 step이 있으면 실패 처리한다.

## 6. TODO 요약
- [ ] `ScenarioEnvironment` 스키마와 저장 로직 구현
- [ ] Tool Recorder/Mock 클래스(동시 구현) 작성
- [ ] Scenario CLI (`record|play|verify`) 스크립트 추가 및 README 문서화
- [ ] Guarded 예제 26이 playback 모드로 PASS하도록 검증

이 문서를 참조하여 CURRENT-TASKS Priority 1 단계 3의 “Scenario Recorder 확장” 항목을 진행한다.
